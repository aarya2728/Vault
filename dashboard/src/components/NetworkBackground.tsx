export function NetworkBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      {/* Subtle architectural grid pattern */}
      <div className="ambient-grid-backdrop absolute inset-0" />
    </div>
  );
}
