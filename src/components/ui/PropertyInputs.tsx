interface PropertySectionProps {
  title: string
  children: React.ReactNode
}

export function PropertySection({ title, children }: PropertySectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">
        {title}
      </div>
      <div className="flex flex-col gap-2">
        {children}
      </div>
    </div>
  )
}

export function PropertyRow({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2">{children}</div>
}

interface NumberInputProps {
  label?: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}

export function NumberInput({ label, value, onChange, min, max, step = 1 }: NumberInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    if (!isNaN(val)) {
      onChange(val)
    }
  }

  return (
    <div className="flex-1 flex items-center gap-1">
      {label && (
        <span className="text-[11px] text-text-muted w-4 shrink-0">{label}</span>
      )}
      <input
        type="number"
        value={Math.round(value * 100) / 100}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
        className="w-full bg-surface-elevated border border-border-light rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-bright"
      />
    </div>
  )
}

interface ColorInputProps {
  value: string
  onChange: (value: string) => void
}

export function ColorInput({ value, onChange }: ColorInputProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded border border-border-light cursor-pointer bg-transparent"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#000000"
        className="flex-1 bg-surface-elevated border border-border-light rounded px-2 py-1 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-bright"
      />
    </div>
  )
}

interface TextInputProps {
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function TextInput({ label, value, onChange, placeholder }: TextInputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <span className="text-[10px] text-text-muted">{label}</span>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-surface-elevated border border-border-light rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-bright"
      />
    </div>
  )
}
