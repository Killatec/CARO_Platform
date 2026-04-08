interface WidgetLabelProps {
  label: string;
  unit?: string | null;
}

export function WidgetLabel({ label, unit }: WidgetLabelProps) {
  return (
    <div className="flex items-baseline gap-1 text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
      <span>{label}</span>
      {unit && <span className="text-gray-400 normal-case tracking-normal">{unit}</span>}
    </div>
  );
}
