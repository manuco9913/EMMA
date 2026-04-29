export function ScenarioPanel() {
  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        height: '100%',
        overflowY: 'auto',
        background: '#f5f5f5',
        borderRight: '1px solid #d0d0d0',
        boxSizing: 'border-box',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Scenario</h2>
      <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>
        Configure scenario parameters here.
      </p>
    </aside>
  )
}
