export const dateLabel = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "Not yet";
export const number = (value?: number | null) => (value || 0).toLocaleString();
export const average = (value?: number | null) =>
  value == null ? "—" : value.toFixed(2);
export const objectLink = (key: string) =>
  `/api/object?key=${encodeURIComponent(key)}`;
