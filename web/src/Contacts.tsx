import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.ts';
import type { Contact } from './api.ts';
import { Icon } from './icons.tsx';
import { avatarColor, initials } from './util.ts';
import { t } from './i18n.ts';

type Draft = { id?: string; name: string; emails: string; phones: string; company: string; notes: string };

const toDraft = (c?: Contact): Draft => ({
  id: c?.id,
  name: c?.name || '',
  emails: (c?.emails || []).join('\n'),
  phones: (c?.phones || []).join('\n'),
  company: c?.company || '',
  notes: c?.notes || '',
});
const lines = (s: string) => s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

export function ContactAvatar({ c, size = 36 }: { c: Pick<Contact, 'name' | 'emails'>; size?: number }) {
  const addr = { name: c.name, address: c.emails[0] || '' };
  return (
    <span className="avatar" style={{ background: avatarColor(addr.address || addr.name), width: size, height: size, fontSize: size * 0.4 }}>
      {initials(addr)}
    </span>
  );
}

export function Contacts({
  contacts,
  reload,
  onCompose,
  flash,
  initial,
}: {
  contacts: Contact[];
  reload: () => Promise<void>;
  onCompose: (to: string) => void;
  flash: (m: string) => void;
  initial?: Partial<Contact> | null;
}) {
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  // "Add to contacts" from a message opens a pre-filled new contact.
  useEffect(() => {
    if (initial) {
      setSelId(null);
      setDraft({ ...toDraft(), name: initial.name || '', emails: (initial.emails || []).join('\n') });
    }
  }, [initial]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return contacts;
    return contacts.filter((c) => [c.name, c.company, ...c.emails, ...c.phones].some((v) => v.toLowerCase().includes(t)));
  }, [contacts, q]);

  const groups = useMemo(() => {
    const g: { letter: string; items: Contact[] }[] = [];
    for (const c of filtered) {
      const ch = (c.name || c.emails[0] || '#')[0].toUpperCase();
      const letter = /\p{L}/u.test(ch) ? ch : '#';
      if (g[g.length - 1]?.letter !== letter) g.push({ letter, items: [] });
      g[g.length - 1].items.push(c);
    }
    return g;
  }, [filtered]);

  const sel = contacts.find((c) => c.id === selId) || null;

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const c = await api.saveContact({
        id: draft.id,
        name: draft.name,
        emails: lines(draft.emails),
        phones: lines(draft.phones),
        company: draft.company,
        notes: draft.notes,
      });
      await reload();
      setSelId(c.id);
      setDraft(null);
    } catch (err) {
      flash((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Contact) => {
    if (!confirm(t('Delete {name}?', { name: c.name || c.emails[0] }))) return;
    try {
      await api.deleteContacts([c.id]);
      await reload();
      setSelId(null);
      flash(t('Contact deleted'));
    } catch (err) {
      flash((err as Error).message);
    }
  };

  const doImport = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const text = await f.text();
      const fmt = /\.vcf$|\.vcard$/i.test(f.name) || /BEGIN:VCARD/i.test(text.slice(0, 2000)) ? 'vcf' : 'csv';
      const r = await api.importContacts(text, fmt);
      await reload();
      flash(t('Imported {added} new, merged {merged} · {total} contacts', { added: r.added, merged: r.merged, total: r.total }));
    } catch (err) {
      flash((err as Error).message);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  const detailOpen = !!(draft || sel);

  return (
    <div className={`contacts ${detailOpen ? 'detail-open' : ''}`}>
      <section className="list contacts-list">
        <div className="contacts-bar">
          <button className="tb new" onClick={() => { setSelId(null); setDraft(toDraft()); }}>
            <Icon name="plus" /> {t('New contact')}
          </button>
          <span className="grow" />
          <button className="tb icon" title={t('Import vCard or CSV')} disabled={busy} onClick={() => file.current?.click()}>
            <Icon name="import" />
          </button>
          <div className="menu-wrap">
            <button className="tb icon" title={t('Export')} disabled={!contacts.length} onClick={() => setExportOpen((v) => !v)}>
              <Icon name="export" />
            </button>
            {exportOpen && (
              <div className="menu export-menu" onMouseLeave={() => setExportOpen(false)}>
                <a href={api.exportUrl('vcf')} onClick={() => setExportOpen(false)}>{t('vCard (.vcf) — Apple, Google, Outlook')}</a>
                <a href={api.exportUrl('csv')} onClick={() => setExportOpen(false)}>{t('CSV (.csv) — Excel')}</a>
              </div>
            )}
          </div>
          <input ref={file} type="file" accept=".vcf,.vcard,.csv,text/vcard,text/csv" hidden onChange={(e) => void doImport(e.target.files)} />
        </div>
        <div className="contacts-search">
          <Icon name="search" size={16} />
          <input placeholder={t('Search {n} contacts', { n: contacts.length })} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="list-scroll">
          {contacts.length === 0 && (
            <div className="empty">
              {t('No contacts yet.')}
              <br />
              <button className="link-btn" onClick={() => file.current?.click()}>{t('Import a vCard or CSV file')}</button>
            </div>
          )}
          {groups.map((g) => (
            <div key={g.letter}>
              <div className="group">{g.letter}</div>
              {g.items.map((c) => (
                <div key={c.id} className={`item contact-item ${c.id === selId && !draft ? 'sel' : ''}`} onClick={() => { setDraft(null); setSelId(c.id); }}>
                  <ContactAvatar c={c} />
                  <div className="item-main">
                    <div className="sender">{c.name || c.emails[0]}</div>
                    <div className="row3">{c.name ? c.emails[0] || c.phones[0] || '' : c.company}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
      <div className="splitter-gap" />
      <main className="reading contact-detail">
        {draft ? (
          <form
            className="contact-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="msg-head">
              <button type="button" className="tb icon back" title={t('Back')} onClick={() => setDraft(null)}>
                <Icon name="chevronRight" />
              </button>
              <h2>{draft.id ? t('Edit contact') : t('New contact')}</h2>
            </div>
            <label>{t('Name')}<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus /></label>
            <label>{t('Email addresses')} <span className="muted small">{t('one per line')}</span>
              <textarea rows={2} value={draft.emails} onChange={(e) => setDraft({ ...draft, emails: e.target.value })} />
            </label>
            <label>{t('Phone numbers')} <span className="muted small">{t('one per line')}</span>
              <textarea rows={2} value={draft.phones} onChange={(e) => setDraft({ ...draft, phones: e.target.value })} />
            </label>
            <label>{t('Company')}<input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} /></label>
            <label>{t('Notes')}<textarea rows={4} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
            <div className="form-actions">
              <button className="primary" disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
              <button type="button" className="pill-btn" onClick={() => setDraft(null)}>{t('Cancel')}</button>
            </div>
          </form>
        ) : sel ? (
          <article className="contact-card">
            <div className="msg-head">
              <button className="tb icon back" title={t('Back')} onClick={() => setSelId(null)}>
                <Icon name="chevronRight" />
              </button>
              <span className="grow" />
              <div className="msg-actions">
                <button className="tb icon" title={t('Edit')} onClick={() => setDraft(toDraft(sel))}><Icon name="compose" /></button>
                <button className="tb icon" title={t('Delete')} onClick={() => void remove(sel)}><Icon name="trash" /></button>
              </div>
            </div>
            <div className="contact-hero">
              <ContactAvatar c={sel} size={72} />
              <div>
                <h2>{sel.name || sel.emails[0]}</h2>
                {sel.company && <div className="muted">{sel.company}</div>}
              </div>
            </div>
            {sel.emails.length > 0 && (
              <div className="contact-section">
                <div className="menu-label">{t('Email')}</div>
                {sel.emails.map((e) => (
                  <div key={e} className="contact-row">
                    <span className="grow">{e}</span>
                    <button className="tb" onClick={() => onCompose(sel.name ? `${sel.name} <${e}>` : e)}><Icon name="send" size={16} /> {t('Send email')}</button>
                  </div>
                ))}
              </div>
            )}
            {sel.phones.length > 0 && (
              <div className="contact-section">
                <div className="menu-label">{t('Phone')}</div>
                {sel.phones.map((p) => (
                  <div key={p} className="contact-row"><a href={`tel:${p.replace(/[^\d+]/g, '')}`}>{p}</a></div>
                ))}
              </div>
            )}
            {sel.notes && (
              <div className="contact-section">
                <div className="menu-label">{t('Notes')}</div>
                <div className="contact-notes">{sel.notes}</div>
              </div>
            )}
          </article>
        ) : (
          <div className="placeholder">
            <Icon name="people" size={56} />
            <p>{contacts.length ? t('Select a contact') : t('Your address book is empty')}</p>
            <p className="muted small">{t('Import from Apple Contacts, Google, Outlook or Thunderbird (vCard or CSV)')}</p>
          </div>
        )}
      </main>
    </div>
  );
}
