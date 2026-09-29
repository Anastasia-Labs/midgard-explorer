import { JsonPanel } from "./jsonpanel";

export function RawData({
  data,
  filename,
  title = "Raw response",
}: {
  data: unknown;
  filename: string;
  title?: string;
}) {
  return (
    <JsonPanel title={title} value={data} variant="full" filename={filename} semantic="rawData" />
  );
}
