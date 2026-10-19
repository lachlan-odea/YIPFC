import { useState } from 'react'
import { Icons } from '../components/ui'
import Scanner from '../components/Scanner'
import SearchAdd from '../components/SearchAdd'
import ImportList from '../components/ImportList'

type Mode = 'scan' | 'search' | 'list'

export default function AddScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('scan')
  return (
    <div className="stack">
      <div>
        <h1 className="title">Add spare cards</h1>
        <p className="subtitle" style={{ marginTop: 6 }}>
          Anything you add here is offered to the pod. You can take it back out any time.
        </p>
      </div>
      <div className="segmented" role="tablist" aria-label="How to add">
        <button role="tab" aria-pressed={mode === 'scan'} onClick={() => setMode('scan')}>
          <span className="row" style={{ justifyContent: 'center', gap: 6 }}>
            <Icons.camera /> Scan
          </span>
        </button>
        <button role="tab" aria-pressed={mode === 'search'} onClick={() => setMode('search')}>
          <span className="row" style={{ justifyContent: 'center', gap: 6 }}>
            <Icons.search /> Search
          </span>
        </button>
        <button role="tab" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>
          <span className="row" style={{ justifyContent: 'center', gap: 6 }}>
            <Icons.list /> List
          </span>
        </button>
      </div>
      {mode === 'scan' && <Scanner onDone={onDone} />}
      {mode === 'search' && <SearchAdd />}
      {mode === 'list' && <ImportList onDone={onDone} />}
    </div>
  )
}
