import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, FileText, FileUp, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import { listKnowledge, addKnowledgeDoc, deleteKnowledgeDoc, searchKnowledge } from '../api/knowledge';
import { apiErrorMessage } from '../api/client';
import { useCan } from '../hooks/useCan';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatRelativeTime } from '../utils/time';
import {
  PageHeader, Button, Card, CardHeader, DataTable, Dialog, Field, Input, Textarea, Menu, MenuButton, confirm,
} from '../components/ui/index';

/**
 * The workspace's Knowledge Base (spec/27 §7): plain-text documents that the
 * `knowledge.search` action searches with an in-process TF-IDF index. Paste text
 * or pick a .txt / .md file; the search panel tries queries before they're
 * wired into a workflow.
 */
export default function KnowledgeBase() {
  useDocumentTitle('Knowledge base');
  const canEdit = useCan('workflow:edit');
  const [docs, setDocs] = useState(null);
  const [limits, setLimits] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listKnowledge();
      setDocs(data.docs || []);
      setLimits(data.limits || null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load documents'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(doc) {
    if (!(await confirm({ title: `Delete “${doc.title}”?`, body: "Workflows searching the knowledge base won't find it any more.", confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await deleteKnowledgeDoc(doc.id);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete the document'));
    }
  }

  const columns = [
    {
      key: 'title',
      header: 'Document',
      sortable: true,
      sortValue: (d) => d.title.toLowerCase(),
      cell: (d) => (
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-default bg-bg-subtle text-subtle">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-fg">{d.title}</div>
            <p className="line-clamp-1 text-xs text-subtle">{d.preview}</p>
          </div>
        </div>
      ),
    },
    { key: 'chunkCount', header: 'Chunks', align: 'right', width: 100, sortable: true, cell: (d) => <span className="tabular-nums text-muted">{d.chunkCount} chunk{d.chunkCount === 1 ? '' : 's'}</span> },
    { key: 'bytes', header: 'Size', align: 'right', width: 90, sortable: true, cell: (d) => <span className="tabular-nums text-muted">{(d.bytes / 1024).toFixed(1)} KB</span> },
    { key: 'createdAt', header: 'Added', width: 120, sortable: true, cell: (d) => <span className="text-sm text-subtle">{formatRelativeTime(d.createdAt)}</span> },
    ...(canEdit ? [{
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 52,
      align: 'right',
      cell: (d) => (
        <Menu
          align="right"
          title={`Actions for ${d.title}`}
          label={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
          buttonClassName="inline-flex h-7 w-7 items-center justify-center rounded-control text-subtle transition-colors hover:bg-bg-subtle hover:text-fg"
        >
          <MenuButton danger onClick={() => remove(d)}><Trash2 className="h-4 w-4" /> Delete</MenuButton>
        </Menu>
      ),
    }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Knowledge base"
        icon={BookOpen}
        description={(
          <>
            Documents the <span className="font-mono text-xs">Knowledge Base → Search</span> action and agents look things up in.
            {limits && ` Up to ${limits.maxDocs} documents of ${Math.round(limits.maxBytes / 1024)} KB each.`}
          </>
        )}
        actions={canEdit && <Button icon={Plus} onClick={() => setAdding(true)}>Add document</Button>}
      />
      {error && <p className="mb-4 text-sm text-danger" role="alert">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DataTable
            columns={columns}
            rows={docs}
            loading={!docs}
            loadingRows={3}
            initialSort={{ key: 'createdAt', dir: 'desc' }}
            empty={{
              icon: BookOpen,
              title: 'No documents yet',
              body: 'Add help-centre articles, policies or notes. Agents and the Knowledge search action look answers up here.',
              action: canEdit ? <Button icon={Plus} onClick={() => setAdding(true)}>Add document</Button> : null,
            }}
          />
        </div>
        <SearchPanel disabled={!docs?.length} />
      </div>

      {adding && <AddDocumentDialog onClose={() => setAdding(false)} onAdded={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function SearchPanel({ disabled }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function search(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError('');
    try {
      const data = await searchKnowledge(query.trim(), 5);
      setResults(data.results || []);
    } catch (err) {
      setError(apiErrorMessage(err, 'Search failed'));
    } finally {
      setBusy(false);
    }
  }

  const top = Math.max(...(results || []).map((r) => Number(r.score) || 0), 0.0001);

  return (
    <Card className="h-fit">
      <CardHeader title="Try a search" description="See which chunks a workflow would get back." icon={Search} />
      <form onSubmit={search} className="flex gap-2 p-4 pb-3">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="How long do refunds take?" aria-label="Search query" disabled={disabled} />
        <Button type="submit" variant="secondary" loading={busy} disabled={disabled}>Search</Button>
      </form>
      {error && <p className="px-4 pb-3 text-xs text-danger">{error}</p>}
      {results && (
        <ul className="space-y-2 px-4 pb-4">
          {!results.length && <li className="text-sm text-subtle">No matching chunks.</li>}
          {results.map((r, i) => (
            <li key={`${r.docId}-${i}`} className="rounded-card border border-default bg-bg-subtle/50 p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-fg">{r.title}</span>
                <span className="shrink-0 tabular-nums text-subtle">score {r.score}</span>
              </div>
              <div className="mb-2 h-1 overflow-hidden rounded-full bg-bg-subtle" aria-hidden="true">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(6, (Number(r.score) / top) * 100)}%` }} />
              </div>
              <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted">{r.chunk}</p>
            </li>
          ))}
        </ul>
      )}
      {!results && disabled && <p className="px-4 pb-4 text-xs text-subtle">Add a document to try searching.</p>}
    </Card>
  );
}

function AddDocumentDialog({ onClose, onAdded }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const fileRef = useRef(null);

  async function readFile(file) {
    if (!file) return;
    if (!/\.(txt|md|markdown)$/i.test(file.name)) {
      setError('Only .txt and .md files are supported.');
      return;
    }
    setError('');
    setFileName(file.name);
    setText(await file.text());
    if (!title) setTitle(file.name.replace(/\.(txt|md|markdown)$/i, ''));
  }

  async function submit(e) {
    e?.preventDefault();
    setError('');
    setSaving(true);
    try {
      await addKnowledgeDoc({ title, text });
      onAdded();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not add the document'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!saving}
      title="Add a document"
      description="Paste text or upload a .txt / .md file. It's split into chunks and indexed for search."
      icon={FileUp}
      size="lg"
      testId="add-document-dialog"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} loading={saving} disabled={!title.trim() || !text.trim()}>Save document</Button>
        </>
      )}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Title" required htmlFor="kb-title">
          <Input id="kb-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Refund policy" autoFocus />
        </Field>
        <Field
          label="Text"
          required
          htmlFor="kb-text"
          trailing={<span className="text-xs tabular-nums text-subtle">{(new Blob([text]).size / 1024).toFixed(1)} KB</span>}
        >
          <Textarea id="kb-text" value={text} onChange={(e) => setText(e.target.value)} rows={9} placeholder="Paste text, or drop a file below" />
        </Field>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); readFile(e.dataTransfer.files?.[0]); }}
          className="flex items-center justify-between gap-3 rounded-card border border-dashed border-strong bg-bg-subtle/50 px-4 py-3"
        >
          <span className="flex items-center gap-2 text-sm text-muted">
            <FileUp className="h-4 w-4 text-subtle" aria-hidden="true" />
            {fileName ? <span className="font-medium text-fg">{fileName}</span> : 'Drop a .txt or .md file here'}
          </span>
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>Choose file</Button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
