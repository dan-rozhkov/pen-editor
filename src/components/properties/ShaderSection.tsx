import { PlusIcon, MinusIcon } from "@phosphor-icons/react";
import type { SceneNode, ShaderKind } from "@/types/scene";
import {
  ColorInput,
  NumberInput,
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

  const action = shader ? (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => onUpdate({ shader: undefined })}
      title="Remove shader"
    >
      <MinusIcon />
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => onUpdate({ shader: defaultShaderConfig() })}
      title="Add shader"
    >
      <PlusIcon />
    </Button>
  );

  return (
    <PropertySection title="Shader" action={action}>
      {shader && desc && (
        <div className="flex flex-col gap-2" data-testid="shader-controls">
          <SelectInput
            label="Type"
            labelOutside
            value={shader.kind}
            options={kindOptions.map((k) => ({ value: k, label: SHADER_REGISTRY[k].label }))}
            onChange={(v) => onUpdate({ shader: defaultShaderConfig(v as ShaderKind) })}
          />
          {desc.presets.length > 0 && (
            <SelectInput
              label="Preset"
              labelOutside
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
                  labelOutside
                  value={val}
                  options={(p.options ?? []).map((o) => ({ value: o, label: o }))}
                  onChange={(v) => onUpdate({ shader: setShaderParam(shader, p.key, v) })}
                />
              );
            }
            if (p.type === "color") {
              const val = typeof current === "string" ? current : (p.default as string);
              return (
                <div key={p.key} className="flex flex-col gap-1">
                  <Label className="text-[10px] font-normal">{p.label}</Label>
                  <ColorInput value={val} onChange={(v) => onUpdate({ shader: setShaderParam(shader, p.key, v) })} />
                </div>
              );
            }
            // 'colors': edit up to four full-width swatches, stacked.
            const arr = Array.isArray(current) ? current : (p.default as string[]);
            return (
              <div key={p.key} className="flex flex-col gap-1">
                <Label className="text-[10px] font-normal">{p.label}</Label>
                {arr.slice(0, 4).map((c, i) => (
                  <ColorInput
                    key={i}
                    value={c}
                    onChange={(v) => onUpdate({ shader: setShaderColorAt(shader, p.key, i, v, arr) })}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </PropertySection>
  );
}
