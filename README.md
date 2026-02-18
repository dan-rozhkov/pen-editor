# Pen Editor

A canvas-based design editor built with React, TypeScript, and Konva.

## Tech Stack

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS v4** - Utility-first CSS framework
- **Konva / react-konva** - Canvas rendering
- **Zustand** - State management
- **clsx** - Conditional CSS class utility

## Styling

This project uses **Tailwind CSS v4** with the Vite plugin. Custom theme colors are defined in `src/index.css`:

```css
@theme {
  --color-surface-base: #1a1a1a;
  --color-surface-panel: #1e1e1e;
  --color-surface-elevated: #2a2a2a;
  --color-accent-primary: #0066cc;
  /* ... */
}
```

Use these colors in components as Tailwind classes:
- `bg-surface-panel`
- `text-text-muted`
- `border-border-default`
- `bg-accent-primary`

For conditional classes, use `clsx`:

```tsx
import clsx from 'clsx'

<div className={clsx(
  'px-3 py-2',
  isSelected && 'bg-accent-primary'
)} />
```

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Design Agent Backend URL

Configure backend URL at build time via Vite env variables:

- `VITE_AI_API_URL` - full chat endpoint URL (example: `https://api.example.com/api/chat`)
- `VITE_DESIGN_AGENT_BACKEND_URL` - backend base URL; app will call `${BASE_URL}/api/chat`

Example:

```bash
VITE_DESIGN_AGENT_BACKEND_URL=https://api.example.com npm run build
```
