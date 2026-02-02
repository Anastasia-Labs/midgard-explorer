export default function BackgroundOrbs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="orb orb-cyan" />
      <div className="orb orb-purple" />
      <div className="orb orb-amber" />
      <div className="orb-grid" />
    </div>
  );
}
