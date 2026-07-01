import type { SceneNode, ShaderKind } from "@/types/scene";
import {
  ColorInput,
  NumberInput,
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";
import { SHADER_REGISTRY, SHADER_KINDS, defaultShaderConfig } from "@/lib/shaders/registry";
import {
  setShaderParam,
  setShaderColorAt,
  SHADER_SUPPORTED_TYPES,
  nodeHasRasterContent,
} from "./shaderSectionUtils";

interface Props {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

export function ShaderSection({ node, onUpdate }: Props) {
  if (!SHADER_SUPPORTED_TYPES.has(node.type)) return null;
  const shader = node.shader;
  const desc = shader ? SHADER_REGISTRY[shader.kind] : null;

  // Image-filter shaders need rasterizable node content; hide them otherwise
  // (but always keep the currently-selected kind so the dropdown stays valid).
  const canImageFilter = nodeHasRasterContent(node);
  const kindOptions = SHADER_KINDS.filter(
    (k) => SHADER_REGISTRY[k].category === "fill" || canImageFilter || k === shader?.kind,
  );

  const toggle = (
    <input
      type="checkbox"
      aria-label="Enable shader"
      className="w-4 h-4 rounded bg-secondary accent-accent-bright cursor-pointer"
      checked={shader != null}
      onChange={(e) => onUpdate({ shader: e.target.checked ? defaultShaderConfig() : undefined })}
    />
  );

  return (
    <PropertySection title="Shader" action={toggle}>
      {shader && desc && (
        <div className="flex flex-col gap-2" data-testid="shader-controls">
          <SelectInput
            label="Type"
            value={shader.kind}
            options={kindOptions.map((k) => ({ value: k, label: SHADER_REGISTRY[k].label }))}
            onChange={(v) => onUpdate({ shader: defaultShaderConfig(v as ShaderKind) })}
          />
          {desc.presets.length > 0 && (
            <SelectInput
              label="Preset"
              value={shader.preset ?? desc.presets[0].name}
              options={desc.presets.map((p) => ({ value: p.name, label: p.name }))}
              onChange={(v) => onUpdate({ shader: { ...shader, preset: v, params: {} } })}
            />
          )}
          {desc.params.map((p) => {
            const current = shader.params[p.key];
            if (p.type === "number") {
              const val = typeof current === "number" ? current : (p.default as number);
              return (
                <NumberInput
                  key={p.key}
                  label={p.label}
                  labelOutside
                  value={val}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  onChange={(v) => onUpdate({ shader: setShaderParam(shader, p.key, v) })}
                />
              );
            }
            if (p.type === "select") {
              const val = typeof current === "string" ? current : (p.default as string);
              return (
                <SelectInput
                  key={p.key}
                  label={p.label}
                  value={val}
                  options={(p.options ?? []).map((o) => ({ value: o, label: o }))}
                  onChange={(v) => onUpdate({ shader: setShaderParam(shader, p.key, v) })}
                />
              );
            }
            if (p.type === "color") {
              const val = typeof current === "string" ? current : (p.default as string);
              return (
                <div key={p.key} className="flex items-center gap-2">
                  <span className="text-[11px] w-12 shrink-0 text-text-primary">{p.label}</span>
                  <ColorInput value={val} onChange={(v) => onUpdate({ shader: setShaderParam(shader, p.key, v) })} />
                </div>
              );
            }
            // 'colors': edit up to four swatches inline.
            const arr = Array.isArray(current) ? current : (p.default as string[]);
            return (
              <div key={p.key} className="flex items-center gap-2">
                <span className="text-[11px] w-12 shrink-0 text-text-primary">{p.label}</span>
                <div className="flex flex-wrap gap-1">
                  {arr.slice(0, 4).map((c, i) => (
                    <ColorInput
                      key={i}
                      value={c}
                      onChange={(v) => onUpdate({ shader: setShaderColorAt(shader, p.key, i, v, arr) })}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PropertySection>
  );
}
