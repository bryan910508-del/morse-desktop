import { Trash2 } from 'lucide-react'

// B342: the one look of a delete choice — «나에게만» and «모두에게» as rows, the one that deletes for everyone in the
// danger colour with no filled button under it, as tdesktop's delete confirmation uses attentionBoxButton (red text, no
// background; boxes/delete_messages_box.cpp:113, :134, :155). The message, chat and history delete boxes all use it
// (history.css .delete-choice); an accent-filled button under red text read poorly.
export interface DeleteChoiceRow { label: string; detail?: string; danger?: boolean; choose(): void }
export function DeleteChoice({ rows }: { rows: (DeleteChoiceRow | null | false)[] }) {
  return <div className="delete-choice">
    {rows.filter((row): row is DeleteChoiceRow => Boolean(row)).map(row =>
      <button key={row.label} type="button" className={`delete-choice-row${row.danger ? ' danger' : ''}`} onClick={row.choose}>
        <span className="delete-choice-icon"><Trash2 size={18} /></span>
        <span><strong>{row.label}</strong>{row.detail && <small>{row.detail}</small>}</span>
      </button>)}
  </div>
}
