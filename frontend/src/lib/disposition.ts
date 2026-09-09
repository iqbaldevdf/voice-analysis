import type { SalesDisposition } from "../api";

export const DISPOSITION_OPTIONS: Array<{ value: SalesDisposition; label: string }> = [
  { value: "hung_up", label: "Hung up" },
  { value: "not_interested", label: "Not Interested" },
  { value: "appointment", label: "Appointment" },
  { value: "follow_up", label: "Follow up" },
  { value: "dnc", label: "DNC" },
];

export function dispositionLabel(value?: SalesDisposition | null): string {
  return DISPOSITION_OPTIONS.find((item) => item.value === value)?.label ?? "Not set";
}

export function dispositionClass(value?: SalesDisposition | null): string {
  return value ? `disposition disposition-${value}` : "disposition disposition-unset";
}
