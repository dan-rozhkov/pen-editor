# Generative Plugins — design spec

**Дата:** 2026-07-21
**Статус:** approved-for-planning (автономная сессия по /goal; решения зафиксированы здесь, возражения юзера — правкой спеки)
**Задачи:** `.claude/.tasks/plg-01..plg-05`

## Цель

Пользователь просит агента в чате: «сделай мне плагин, который …» — агент пишет
код плагина, плагин устанавливается в библиотеку, запускается из command palette
/ панели плагинов и итерируется дальше через чат. Аналог generative plugins,
показанных Figma на Config 2026 (агент пишет плагин по промпту, юзер жмёт Run,
итерации через чат).

Это пересматривает пункт «Плагины / публичный API — не делаем» из
PROGRESS.md: строим не публичную платформу, а расширяемость для одного
пользователя, где автор плагинов — AI.

## Что выяснил ресёрч Figma Plugin API

- Figma исполняет логику плагина **синхронно на главном потоке** в песочнице
  QuickJS→Wasm (после дыр в Realms-shim), а UI — в отдельном null-origin iframe;
  связь только через postMessage. Синхронность выбрана из-за DX и цены
  сериализации гигантских документов (14 с на файл Microsoft).
- manifest.json декларирует `main`/`ui`/`networkAccess`/`permissions`; сеть
  режется CSP без runtime-промптов.
- Generative plugins (июнь 2026): код пишет агент, плагин живёт в файле,
  запускается тем же рантаймом, итерации prompt-mediated, код юзеру не
  показывают.

## Выбранный подход

Рассмотрены три варианта рантайма:

1. **QuickJS/Wasm-песочница с синхронным API (как Figma)** — лучшая DX и
   безопасность, но тяжёлая инфраструктура (интерпретатор, мембрана API).
2. **Sandbox-iframe + async RPC** ✅ — логика и UI плагина живут в одном
   `<iframe sandbox="allow-scripts">` (null origin), API асинхронный через
   postMessage. Аргумент Figma против iframe (сериализация огромных документов)
   к нам не применим: документы pen-editor маленькие, а API мы строим не на
   передаче всего документа, а на существующем tool-словаре. Автор плагинов —
   AI, которому async/await не мешает.
3. **Web Worker + RPC** — изолирует логику, но не даёт UI; понадобился бы
   второй контур как у Figma.

**Решение: вариант 2.** Один sandbox-iframe на запущенный плагин: скрытый для
headless-плагинов, видимый во floating-панели для плагинов с UI. QuickJS —
осознанно отложенная опция (plg-05), если когда-нибудь захочется синхронного
API.

## Архитектура

### Модель плагина

```ts
interface PenPlugin {
  id: string;            // nanoid
  name: string;
  description: string;
  icon?: string;         // emoji
  code: string;          // JS, исполняется в iframe как <script type="module">
  ui?: { width: number; height: number } | null; // null = headless
  source: "ai" | "imported";
  createdAt: number;
  updatedAt: number;
}
```

Хранение — **app-level в IndexedDB** (`src/utils/pluginDb.ts` по образцу
`customFontDb.ts`) + лёгкий zustand `pluginStore` (список метаданных в памяти).
Документо-скоупные плагины внутри `.pen` (как у Figma «живёт в файле») —
отложено в plg-05: для личного инструмента библиотека полезнее.

### Рантайм (`src/lib/plugins/`)

- `pluginHost.ts` — создаёт iframe (`sandbox="allow-scripts"`, srcdoc =
  bootstrap + код плагина), держит реестр запущенных инстансов, teardown по
  `pen.close()` / закрытию панели / повторному запуску.
- `pluginBridge.ts` — postMessage RPC: `{callId, method, args}` →
  `{callId, result | error}`; на стороне iframe bootstrap собирает из этого
  промис-API `pen.*`. Все входящие сообщения валидируются (source-window +
  структура), неизвестные методы отклоняются.
- `pluginApi.ts` — фасад хоста. **Ядро API — существующий tool-словарь**: RPC
  метод `runTool(name, args)` диспатчит в `toolRegistry` по allowlist'у
  (batch_design, batch_get, get_editor_state, snapshot_layout, get_variables,
  set_variables, get/set_text_styles, get/set_styles, apply_*_style,
  find_empty_space_on_canvas, search_all_unique_properties,
  replace_all_matching_properties, rename_layers, boolean_operation,
  generate_image; исключены comments-инструменты и get_screenshot).
  Это даёт: (а) историю/транзакционность batch_design бесплатно, (б) агент уже
  знает этот словарь — генерация кода надёжнее.

### `pen.*` API v1 (внутри iframe, всё async)

```js
await pen.tools.run("batch_design", { operations: "..." }); // строка-результат
await pen.scene.batch("f=I(document, {type:'frame',...})"); // сахар над batch_design
await pen.scene.get(ids?);            // сахар над batch_get / get_editor_state
const sel = await pen.selection.get(); // ids
await pen.selection.set(ids);
await pen.viewport.zoomTo(ids);
pen.notify("Готово ✔");
await pen.storage.get(key); await pen.storage.set(key, value); // per-plugin namespace в localStorage
pen.ui.resize(w, h);                  // только для UI-плагинов
pen.on("selectionchange", cb);        // v1: только это событие
pen.close();
```

UI-плагин просто рендерит DOM внутри своего же iframe — двух контуров, как у
Figma (`showUI` + `__html__`), нет. Тема: хост прокидывает CSS-переменные
токенов и `data-theme` в bootstrap.

### Undo

Каждый `pen.tools.run` мутирующего инструмента = одна history-запись (это уже
даёт batch_design). `pen.history.batch(fn)` с `withHistoryBatch` — в v1 не
делаем; если плагин делает несколько batch-вызовов, будет несколько undo-шагов.
Зафиксировано как ограничение.

### Поверхности запуска

- **Command palette**: новая группа `"Plugins"` (расширить закрытый union
  `CommandGroupName` в `src/lib/commands/types.ts`); `getCommands()` дочитывает
  команды из `pluginStore` — по одной на плагин (`mutatesScene: true`, чтобы
  фильтроваться в dev/inspect-режиме) + «Manage plugins…».
- **Панель плагинов** (менеджер): список, запуск, переименование, просмотр кода
  (read-only), удаление, export/import JSON-файла плагина.
- UI-плагины открываются во floating-панели (draggable/resizable, по образцу
  draggable-popovers), внутри — их sandbox-iframe.

### AI-генерация (split-execution, как все инструменты)

- **Backend** (`pen-editor-backend`):
  - Клиент-исполняемые тулы в `penTools`: `create_plugin({name, description,
    icon?, code, ui?})`, `update_plugin({id, code?, name?, ...})`,
    `list_plugins()`.
  - Скилл `plugin.md` (`/plugin` + auto-select через каталог): справка по
    `pen.*` API, правила (async-only, tool-словарь, лимиты, UI-паттерн),
    примеры. Схемы тулов минимальны — вся «документация API» живёт в скилле,
    чтобы не раздувать системный промпт.
- **Frontend**: хендлеры в `src/lib/tools/plugins/`: валидация (размер кода
  ≤ 100 KB, обязательные поля), запись в pluginDb/pluginStore, результат —
  `plugin installed: <id> "<name>". User can run it from the command palette or
  plugins panel.` Итерация: агент вызывает `list_plugins` → `update_plugin`.
- **Порядок мерджа — backend first** (contract CI проверяет обе стороны;
  правило из корневого CLAUDE.md).

### Безопасность

- `sandbox="allow-scripts"` без `allow-same-origin` ⇒ null origin: нет доступа
  к localStorage/IndexedDB/DOM приложения; единственный канал — RPC allowlist.
- Сеть из iframe: обычный browser fetch с null origin (работают только
  CORS-`*` API). Манифест-allowlist а-ля Figma `networkAccess` — plg-05.
- Лимиты: существующий cap 25 операций на batch_design; таймаут RPC-вызова;
  один запущенный инстанс на плагин.
- Код пишет AI по запросу самого пользователя и хранится локально — модель
  угроз мягче фигмовской (нет стороннего маркетплейса).

### Тестирование

- Unit (Vitest, happy-dom): `pluginBridge` протокол (валидация, unknown method,
  timeouts) с фейковым `Window`; `pluginApi` allowlist против реальных сторов
  (`resetStores()`/`seedScene()`); хендлеры `create/update/list_plugins`;
  contract-тест имён тулов обновляется на обеих сторонах.
- E2E (Playwright): реальный iframe — установить фикстурный плагин, запустить
  из palette, проверить появление узла в sceneStore; smoke AI-потока через
  застабленный `/api/chat`, стримящий `create_plugin`.
- Backend: zod-контракты новых схем; тест инъекции скилла `plugin`.

## Этапы (задачи)

| Задача | Что | Репо | Сложность |
|---|---|---|---|
| plg-01 | Рантайм: iframe-хост, RPC-мост, фасад `pen.*` | pen-editor | L |
| plg-02 | Библиотека (IndexedDB) + менеджер-панель + palette-группа | pen-editor | M |
| plg-03 | AI-генерация: тулы create/update/list_plugins + скилл `/plugin` | оба | M |
| plg-04 | UI-плагины: floating-панель, resize, тема | pen-editor | M |
| plg-05 | P2-бэклог: doc-scoped плагины в .pen, network-манифест, события сцены, QuickJS-синхронный API, экспорт кода | — | — |

Порядок: plg-01 → plg-02 → plg-03 (после него фича уже «генеративная») → plg-04.

## Вне скоупа v1

Маркетплейс/шаринг, монетизация, параметры quick-run, relaunch-данные на узлах,
подписки на documentchange, синхронный API, плагины в файле документа.
