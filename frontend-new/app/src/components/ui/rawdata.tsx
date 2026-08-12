import { JsonPanel } from "./jsonpanel";

export function RawData({ data, filename }: { data: unknown; filename: string }) {
  return (
    <JsonPanel
      title="Raw response"
      value={data}
      variant="full"
      filename={filename}
      semantic="rawData"
    />
  );
}
