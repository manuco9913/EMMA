import { useState } from 'react'

type Props = {
  onSave: (name: string) => void
  onDiscard: () => void
  onCancel: () => void
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}

const panel: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: '24px',
  width: 340,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
}

const btn: React.CSSProperties = {
  padding: '8px 0',
  borderRadius: 4,
  border: 'none',
  fontSize: 13,
  cursor: 'pointer',
}

export function SaveDiscardModal({ onSave, onDiscard, onCancel }: Props) {
  const [name, setName] = useState('')

  return (
    <div style={overlay} onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Unsaved run"
        style={panel}
        onClick={e => e.stopPropagation()}
      >
        <p style={{ margin: 0, fontSize: 14, color: '#333' }}>
          You have an unsaved run. Save it before re-running?
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label htmlFor="run-name" style={{ fontSize: 12, fontWeight: 500, color: '#555' }}>
            Run name
          </label>
          <input
            id="run-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Name this run…"
            style={{
              padding: '6px 8px',
              border: '1px solid #ccc',
              borderRadius: 4,
              fontSize: 13,
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            style={{ ...btn, background: '#1a6ef5', color: '#fff', opacity: name.trim() ? 1 : 0.5 }}
            disabled={!name.trim()}
            onClick={() => onSave(name.trim())}
          >
            Save &amp; Re-run
          </button>
          <button
            style={{ ...btn, background: '#e53e3e', color: '#fff' }}
            onClick={onDiscard}
          >
            Discard &amp; Re-run
          </button>
          <button
            style={{ ...btn, background: '#f0f0f0', color: '#333' }}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
