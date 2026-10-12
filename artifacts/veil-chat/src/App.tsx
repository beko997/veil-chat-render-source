import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  getHealthCheckQueryKey, getListRoomsQueryKey, getListRoomMessagesQueryKey,
  useHealthCheck, useListRooms, useListRoomMessages, useCreateRoom, useCreateRoomMessage,
} from '@workspace/api-client-react';
import type { Room as RoomRecord, RoomMessage } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  ArrowDown, ArrowUpRight, BadgeCheck, CircleHelp, Copy, Hash,
  KeyRound, LockKeyhole, Menu, MessageCircle, Plus, Radio, Send, Settings2, Shield,
  ShieldCheck, Sparkles, Users, X,
} from 'lucide-react';
import {
  createRoomKey,
  decryptMessage,
  decryptRoomMetadata,
  encryptMessage,
  encryptRoomMetadata,
  type MessagePayload,
  type RoomMetadata,
} from '@/lib/crypto';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();
const EMPTY_ROOMS: RoomRecord[] = [];
const EMPTY_MESSAGES: RoomMessage[] = [];

type ClientRoom = RoomRecord & RoomMetadata & { locked: boolean };

function readInvite(value: string) {
  const trimmed = value.trim();
  const hashIndex = trimmed.lastIndexOf('#');
  const candidate = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : trimmed;
  const match = candidate.match(/^(?:join\/|veil:\/\/join\/)([^?]+)\?key=(.+)$/);
  if (!match) return null;
  try {
    return {
      roomId: decodeURIComponent(match[1]),
      key: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

function Home() {
  const queryClient = useQueryClient();
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30000 } });
  const roomsQuery = useListRooms({ query: { queryKey: getListRoomsQueryKey(), retry: 1 } });
  const createRoomMutation = useCreateRoom();
  const createMessageMutation = useCreateRoomMessage();
  const roomRecords = roomsQuery.data ?? EMPTY_ROOMS;
  const [rooms, setRooms] = useState<ClientRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState('');
  const activeRoom = rooms.find((room) => room.id === activeRoomId);
  const messagesQuery = useListRoomMessages(activeRoomId, {
    query: { enabled: Boolean(activeRoomId), queryKey: getListRoomMessagesQueryKey(activeRoomId), refetchInterval: 8000, retry: 1 },
  });
  const [modal, setModal] = useState<'create' | 'join' | 'invite' | 'settings' | 'privacy' | null>(null);
  const [roomKind, setRoomKind] = useState<'channel' | 'direct'>('channel');
  const [roomName, setRoomName] = useState('');
  const [topic, setTopic] = useState('');
  const [joinId, setJoinId] = useState('');
  const [joinKey, setJoinKey] = useState('');
  const [alias, setAlias] = useState(() => localStorage.getItem('veil.alias') || 'misafir');
  const [draftAlias, setDraftAlias] = useState(alias);
  const [keys, setKeys] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('veil.room-keys') || '{}') as Record<string, string>; }
    catch { return {}; }
  });
  const [decrypted, setDecrypted] = useState<Record<string, MessagePayload>>({});
  const [draft, setDraft] = useState('');
  const [formError, setFormError] = useState('');
  const [copied, setCopied] = useState(false);
  const [pendingInvite, setPendingInvite] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [filter, setFilter] = useState('');
  const [showKey, setShowKey] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const messageList = messagesQuery.data ?? EMPTY_MESSAGES;
  const channels = useMemo(() => rooms.filter((room) => !room.locked && room.kind === 'channel'), [rooms]);
  const directs = useMemo(() => rooms.filter((room) => !room.locked && room.kind === 'direct'), [rooms]);
  const lockedRooms = useMemo(() => rooms.filter((room) => room.locked), [rooms]);
  const matchingRooms = useMemo(() => rooms.filter((room) => room.name.toLocaleLowerCase('tr').includes(filter.toLocaleLowerCase('tr'))), [rooms, filter]);
  const online = health.data?.status === 'ok' || health.data?.status === 'healthy';

  useEffect(() => {
    let cancelled = false;
    Promise.all(roomRecords.map(async (room): Promise<ClientRoom> => {
      const key = keys[room.id];
      if (!key || !room.metadataCiphertext || !room.metadataIv) {
        return {
          ...room,
          kind: 'channel',
          name: `Şifreli oda · ${room.id.slice(0, 6)}`,
          topic: 'Görüntülemek için davet anahtarı gerekiyor.',
          locked: true,
        };
      }
      try {
        const metadata = await decryptRoomMetadata(room.metadataCiphertext, room.metadataIv, key, room.id);
        return { ...room, ...metadata, locked: false };
      } catch {
        return {
          ...room,
          kind: 'channel',
          name: `Anahtar gerekiyor · ${room.id.slice(0, 6)}`,
          topic: 'Bu oda için geçerli davet bağlantısını kullanın.',
          locked: true,
        };
      }
    })).then((resolved) => { if (!cancelled) setRooms(resolved); });
    return () => { cancelled = true; };
  }, [roomRecords, keys]);

  useEffect(() => {
    if (pendingInvite && activeRoom && activeRoom.id === activeRoomId && !activeRoom.locked) {
      setModal('invite');
      setPendingInvite(false);
    }
  }, [pendingInvite, activeRoom, activeRoomId]);

  useEffect(() => {
    let cancelled = false;
    const key = activeRoomId ? keys[activeRoomId] : '';
    if (!key || !messageList.length) { setDecrypted({}); return; }
    Promise.all(messageList.map(async (message) => {
      try { return [message.id, await decryptMessage(message.ciphertext, message.iv, key, activeRoomId)] as const; }
      catch { return [message.id, { senderAlias: 'Gizli katılımcı', text: 'Bu mesaj çözülemedi; davet anahtarını kontrol edin.' }] as const; }
    })).then((entries) => { if (!cancelled) setDecrypted(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [activeRoomId, keys, messageList]);

  useEffect(() => {
    const invite = readInvite(window.location.href);
    if (!invite) return;
    const room = roomRecords.find((item) => item.id === invite.roomId);
    if (!room) return;
    if (keys[room.id] !== invite.key) saveKeys({ ...keys, [room.id]: invite.key });
    setActiveRoomId(room.id);
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
  }, [roomRecords, keys]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messageList.length, activeRoomId]);

  useEffect(() => {
    function onKeyboardShortcut(event: KeyboardEvent) {
      if (event.key === 'Escape') { setModal(null); setMobileNav(false); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.search-box input')?.focus();
      }
    }
    window.addEventListener('keydown', onKeyboardShortcut);
    return () => window.removeEventListener('keydown', onKeyboardShortcut);
  }, []);

  function saveKeys(next: Record<string, string>) {
    setKeys(next);
    localStorage.setItem('veil.room-keys', JSON.stringify(next));
  }

  function startCreate(kind: 'channel' | 'direct') {
    setRoomKind(kind);
    setRoomName('');
    setTopic('');
    setFormError('');
    setModal('create');
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    const cleanName = roomName.trim().replace(/^#/, '');
    if (!cleanName) { setFormError('Önce bu odaya bir ad verin.'); return; }
    const id = crypto.randomUUID();
    const key = createRoomKey();
    const metadata: RoomMetadata = { kind: roomKind, name: cleanName, topic: topic.trim() || null };
    void encryptRoomMetadata(metadata, key, id).then(({ ciphertext, iv }) => {
      createRoomMutation.mutate({ data: { id, metadataCiphertext: ciphertext, metadataIv: iv } }, {
      onSuccess: (room) => {
        saveKeys({ ...keys, [room.id]: key });
        queryClient.setQueryData<RoomRecord[]>(getListRoomsQueryKey(), (current) => {
          const existing = current ?? [];
          return existing.some((item) => item.id === room.id) ? existing : [...existing, room];
        });
        setActiveRoomId(room.id);
        setModal(null);
        setPendingInvite(roomKind === 'direct');
        void queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() });
      },
      onError: () => setFormError('Oda oluşturulamadı. Biraz sonra yeniden deneyin.'),
      });
    }).catch(() => setFormError('Oda bilgileri bu tarayıcıda şifrelenemedi.'));
  }

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pastedInvite = readInvite(joinId);
    const roomId = pastedInvite?.roomId ?? joinId.trim();
    const keyFromInvite = pastedInvite?.key ?? joinKey.trim();
    const room = roomRecords.find((item) => item.id === roomId);
    if (!room) { setFormError('Bu oda kimliği bulunamadı. Kimliği veya davet bağlantısını kontrol edin.'); return; }
    if (keyFromInvite.length < 20) { setFormError('Davet bağlantısındaki oda anahtarını ekleyin.'); return; }
    saveKeys({ ...keys, [room.id]: keyFromInvite });
    setActiveRoomId(room.id);
    setJoinId('');
    setJoinKey('');
    setModal(null);
    setFormError('');
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeRoom || !draft.trim() || !keys[activeRoom.id] || createMessageMutation.isPending) return;
    const plaintext = draft.trim();
    setDraft('');
    try {
      const encrypted = await encryptMessage(plaintext, alias || 'misafir', keys[activeRoom.id], activeRoom.id);
      createMessageMutation.mutate({
        roomId: activeRoom.id,
        data: { ciphertext: encrypted.ciphertext, iv: encrypted.iv },
      }, {
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListRoomMessagesQueryKey(activeRoom.id) }),
        onError: () => setDraft(plaintext),
      });
    } catch {
      setDraft(plaintext);
      setFormError('Bu tarayıcıda şifreleme başarısız oldu; mesajınız gönderilmedi.');
    }
  }

  async function copyInvite() {
    if (!activeRoom || !keys[activeRoom.id]) return;
    const invite = `${window.location.origin}${window.location.pathname}#join/${encodeURIComponent(activeRoom.id)}?key=${encodeURIComponent(keys[activeRoom.id])}`;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch { setFormError('Panoya erişim engellendi. Davet bağlantısını aşağıdaki alandan kopyalayabilirsiniz.'); }
  }

  function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draftAlias.trim().slice(0, 40) || 'misafir';
    setAlias(next);
    localStorage.setItem('veil.alias', next);
    setModal(null);
  }

  const isError = roomsQuery.isError;
  return (
    <div className="veil-shell veil-grain">
      <div className="app-frame">
        <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
          <div className="brand-row">
            <div className="brand-mark"><span /></div>
            <div className="brand-word">veil<span>.</span><small>GİZLİ SOHBET ALANI</small></div>
            <button className="icon-button mobile-close" aria-label="Menüyü kapat" onClick={() => setMobileNav(false)}><X size={17} /></button>
          </div>
          <div className="identity-strip">
            <div className="identity-avatar">{alias.slice(0, 1).toUpperCase()}</div>
            <div className="identity-copy"><strong>{alias}</strong><span><i className={online ? 'status-dot' : 'status-dot offline'} />{health.isLoading ? 'bağlanıyor…' : online ? 'sunucuya bağlı' : 'yerel kimlik'}</span></div>
            <button className="tiny-icon" aria-label="Kimlik ayarları" onClick={() => { setDraftAlias(alias); setModal('settings'); }}><Settings2 size={16} /></button>
          </div>
          <div className="sidebar-tools">
            <label className="search-box"><span>/</span><input aria-label="Oda ara" placeholder="Odalarında ara" value={filter} onChange={(event) => setFilter(event.target.value)} /><kbd>⌘ K</kbd></label>
          </div>
          <nav className="room-nav" aria-label="Sohbet odaları">
            <div className="nav-section-head"><span>KANALLARIN <small>{channels.length.toString().padStart(2, '0')}</small></span><button className="tiny-icon" aria-label="Kanal oluştur" onClick={() => startCreate('channel')}><Plus size={17} /></button></div>
            <div className="room-list">
              {matchingRooms.filter((room) => !room.locked && room.kind === 'channel').map((room) => (
                <RoomNavItem key={room.id} room={room} active={room.id === activeRoomId} onClick={() => { setActiveRoomId(room.id); setMobileNav(false); }} locked={room.locked} />
              ))}
              {!channels.length && <div className="nav-empty">Henüz kanal yok<span>Bir kanal aç veya davetle katıl.</span></div>}
            </div>
            <div className="nav-section-head direct-head"><span>ÖZEL SOHBETLER <small>{directs.length.toString().padStart(2, '0')}</small></span><button className="tiny-icon" aria-label="Özel sohbet başlat" onClick={() => startCreate('direct')}><Plus size={17} /></button></div>
            <div className="room-list">
              {matchingRooms.filter((room) => !room.locked && room.kind === 'direct').map((room) => (
                <RoomNavItem key={room.id} room={room} active={room.id === activeRoomId} onClick={() => { setActiveRoomId(room.id); setMobileNav(false); }} locked={room.locked} />
              ))}
              {!directs.length && <div className="nav-empty">Burası şimdilik sakin<span>Özel bir oda açıp davet gönder.</span></div>}
            </div>
            {!!lockedRooms.length && <><div className="nav-section-head direct-head"><span>KİLİTLİ ODALAR <small>{lockedRooms.length.toString().padStart(2, '0')}</small></span></div><div className="room-list">{matchingRooms.filter((room) => room.locked).map((room) => <RoomNavItem key={room.id} room={room} active={room.id === activeRoomId} onClick={() => { setActiveRoomId(room.id); setMobileNav(false); }} locked />)}</div></>}
          </nav>
          <div className="sidebar-bottom">
            <div className="privacy-mini"><div className="privacy-icon"><LockKeyhole size={15} /></div><div><strong>Anahtarların sende.</strong><span>İçerik gönderilmeden önce şifrelenir.</span></div></div>
            <button className="nav-bottom-button" onClick={() => setModal('privacy')}><CircleHelp size={16} /> Gizlilik nasıl çalışır? <ArrowUpRight size={13} /></button>
            <div className="version-row"><span><i className={online ? 'status-dot' : 'status-dot offline'} />{online ? 'Bağlantı etkin' : 'Sunucuya ulaşılamıyor'}</span><span>VEIL / 01</span></div>
          </div>
        </aside>

        <main className="main-panel">
          <header className="topbar">
            <button className="icon-button mobile-menu" aria-label="Menüyü aç" onClick={() => setMobileNav(true)}><Menu size={19} /></button>
            <div className="breadcrumbs"><span>SOHBETİN</span><span className="crumb-slash">/</span><strong>{activeRoom ? `${activeRoom.kind === 'channel' && !activeRoom.locked ? '#' : ''}${activeRoom.name}` : 'ANA SAYFA'}</strong></div>
            <div className="top-actions"><span className="encryption-pill"><span className="pulse-dot" /><LockKeyhole size={12} /> UÇTAN UCA ŞİFRELİ</span><button className="top-icon" aria-label="Gizlilik bilgileri" onClick={() => setModal('privacy')}><Shield size={17} /></button></div>
          </header>

          {isError ? <div className="center-state veil-in"><div className="state-emblem warning"><Radio size={24} /></div><p className="eyebrow">BAĞLANTI KESİLDİ</p><h1>Sohbet burada bekler.</h1><p>Oda listesine şu anda ulaşılamıyor. Yerel kimliğin ve anahtarların bu cihazda kalır.</p><button className="primary-button" onClick={() => void roomsQuery.refetch()}>Yeniden dene <ArrowUpRight size={15} /></button></div>
            : roomsQuery.isLoading ? <div className="loading-shell"><div className="loading-header" /><div className="loading-line wide" /><div className="loading-line" /><div className="loading-card" /></div>
              : activeRoom ? (
                <section className="conversation veil-in" key={activeRoom.id}>
                  <div className="conversation-head">
                    <div className="room-symbol">{activeRoom.locked ? <LockKeyhole size={18} /> : activeRoom.kind === 'channel' ? <Hash size={19} /> : <MessageCircle size={18} />}</div>
                    <div className="room-heading"><div className="room-title">{activeRoom.kind === 'channel' && !activeRoom.locked && <span className="hash-title">#</span>}{activeRoom.name}<span className="sealed-label"><LockKeyhole size={11} /> ŞİFRELİ</span></div><p>{activeRoom.topic || 'Küçük, güvenli bir sohbet alanı.'}</p></div>
                    <div className="conversation-actions"><div className="participant-count"><Users size={15} /><span>{activeRoom.locked ? 'anahtar gerekli' : activeRoom.kind === 'channel' ? 'kanal' : 'davetli sohbet'}</span></div><button className="outline-button invite-button" onClick={() => setModal('invite')} disabled={activeRoom.locked}><Plus size={14} /> Davet et</button></div>
                  </div>
                  <div className="conversation-body">
                    <div className="date-break"><span /> <p>BU ODANIN BAŞLANGICI</p> <span /></div>
                    {messagesQuery.isLoading && <div className="message-skeleton"><i /><span /><b /></div>}
                    {messagesQuery.isError && <div className="inline-error">Mesajlar yüklenemedi. <button onClick={() => void messagesQuery.refetch()}>Yeniden dene</button></div>}
                    {!messagesQuery.isLoading && !messagesQuery.isError && messageList.length === 0 && (
                      <div className="first-message"><div className="first-orbit"><Sparkles size={20} /></div><span className="eyebrow">YENİ BİR BAŞLANGIÇ</span><h2>Bu odayı<br /><em>kendine göre şekillendir.</em></h2><p>Bir düşünce paylaş, soru sor ya da merhaba de. Mesajların tarayıcında şifrelenir.</p><button onClick={() => document.getElementById('message-composer')?.focus()}>İlk mesajını yaz <ArrowDown size={14} /></button></div>
                    )}
                    {messageList.map((message) => <MessageRow key={message.id} message={message} payload={decrypted[message.id]} mine={decrypted[message.id]?.senderAlias === alias} />)}
                    <div ref={endRef} />
                  </div>
                  <form className="composer-wrap" onSubmit={sendMessage}>
                    {!keys[activeRoom.id] && <div className="key-warning"><KeyRound size={14} /> Bu oda anahtarı bu cihazda yok. <button type="button" onClick={() => setModal('join')}>Anahtarı ekle</button></div>}
                    <div className="composer">
                      <textarea id="message-composer" data-testid="input-message-composer" aria-label="Şifreli mesaj yaz" placeholder={keys[activeRoom.id] ? `${activeRoom.kind === 'channel' ? '#' : ''}${activeRoom.name} odasına mesaj yaz…` : 'Yazmak için oda anahtarını ekle'} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(new Event('submit') as unknown as FormEvent<HTMLFormElement>); } }} disabled={!keys[activeRoom.id]} />
                      <div className="composer-foot"><span><LockKeyhole size={12} /> Bu cihazda şifrelenir <span className="composer-dot">·</span> <span className="alias-foot">{alias}</span></span><button aria-label="Şifreli mesaj gönder" type="submit" disabled={!draft.trim() || !keys[activeRoom.id] || createMessageMutation.isPending}><span>{createMessageMutation.isPending ? 'Şifreleniyor' : 'Gönder'}</span><Send size={14} /></button></div>
                    </div>
                    {formError && <div className="form-error">{formError}</div>}
                    <div className="composer-note">Sunucu oda adlarını ve mesaj içeriğini çözemez; bağlantı ve zamanlama bilgileri görünür kalır.</div>
                  </form>
                </section>
              ) : (
                <section className="lobby veil-in">
                  <div className="lobby-scroll">
                    <div className="welcome-kicker"><span className="pulse-dot" /> DAHA GİZLİ BİR SOHBET</div>
                    <div className="hero-copy"><h1>Özgürce konuş.<br /><em>Daha az iz bırak.</em></h1><p>Kanallar, özel sohbetler ve uçtan uca şifreleme. Oda adları, konu başlıkları, takma adlar ve mesajlar cihazından çıkmadan önce şifrelenir.</p></div>
                    <div className="hero-actions"><button className="primary-button" onClick={() => startCreate('channel')}><Plus size={16} /> Kanal oluştur <ArrowUpRight size={15} /></button><button className="quiet-button" onClick={() => setModal('join')}>Davetle katıl <ArrowDown size={14} /></button></div>
                    <div className="lobby-rule"><span>SANA AİT ALAN</span><i /></div>
                    {rooms.length === 0 ? (
                      <div className="empty-room-panel">
                        <div className="empty-illustration"><div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="orbit-core"><LockKeyhole size={19} /></div><span className="star star-a" /><span className="star star-b" /></div>
                        <div className="empty-copy"><p className="eyebrow">ACELE YOK</p><h2>Her güzel sohbet<br />bir yerden başlar.</h2><p>Bir kanal aç ya da özel bir oda oluşturup davet bağlantısını paylaş. Oda adları ve mesajlar sunucuya şifreli gider; oda kimliği, zamanlama ve IP bilgileri görünür kalabilir.</p><button onClick={() => startCreate('direct')}>Özel sohbet başlat <ArrowUpRight size={14} /></button></div>
                        <div className="empty-index">01 <span>/</span> 03</div>
                      </div>
                    ) : (
                      <div className="room-welcome-list">
                        <div className="room-welcome-title"><div><p className="eyebrow">ODA LİSTESİ</p><h2>Sohbetine kaldığın yerden devam et.</h2></div><button className="outline-button" onClick={() => setModal('join')}>Odaya katıl <ArrowUpRight size={14} /></button></div>
                        {matchingRooms.map((room) => <button className="welcome-room" key={room.id} onClick={() => setActiveRoomId(room.id)}><span className="welcome-room-mark">{room.locked ? <LockKeyhole size={15} /> : room.kind === 'channel' ? <Hash size={16} /> : <MessageCircle size={15} />}</span><span><strong>{!room.locked && room.kind === 'channel' ? '#' : ''}{room.name}</strong><small>{room.topic || (room.kind === 'channel' ? 'Açık kanal' : 'Özel sohbet')}</small></span><span className="welcome-room-lock">{keys[room.id] ? <LockKeyhole size={13} /> : <KeyRound size={13} />}</span><ArrowUpRight size={14} /></button>)}
                      </div>
                    )}
                    <div className="principles">
                      <div className="principle"><span className="principle-number">01</span><div><LockKeyhole size={16} /><h3>Göndermeden önce şifrelenir</h3><p>Mesajlar, takma adlar, oda adları ve konular şifrelenir.</p></div></div>
                      <div className="principle"><span className="principle-number">02</span><div><KeyRound size={16} /><h3>Anahtarlar sende kalır</h3><p>Oda anahtarları bu tarayıcıda saklanır, sunucuya gönderilmez.</p></div></div>
                      <div className="principle"><span className="principle-number">03</span><div><Radio size={16} /><h3>Sınırları açıkça anlatırız</h3><p>IP adresi ve trafik bilgileri şifrelemeyle gizlenmez.</p></div></div>
                    </div>
                    <div className="lobby-footer"><span>VEIL SOHBET / TARAYICINDA ŞİFRELENİR</span><button onClick={() => setModal('privacy')}>Gizlilik notları <ArrowUpRight size={12} /></button></div>
                  </div>
                </section>
              )}
        </main>
      </div>
      {mobileNav && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setModal(null); setFormError(''); } }}>
        <div className="modal-card veil-rise" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button className="modal-close" aria-label="Close dialog" onClick={() => { setModal(null); setFormError(''); }}><X size={18} /></button>
          {modal === 'create' && <>
            <div className="modal-icon"><Plus size={19} /></div><p className="eyebrow">YENİ BİR ALAN AÇ</p><h2 id="modal-title">{roomKind === 'channel' ? 'Yeni kanal oluştur.' : 'Özel sohbet başlat.'}</h2><p className="modal-intro">{roomKind === 'channel' ? 'Sohbetine bir alan aç. Davet bağlantısını paylaştığın kişiler katılabilir.' : 'Özel bir alan oluştur. Bağlantı ve anahtar kimdeyse odayı açabilir.'}</p>
            <div className="segmented-control"><button className={roomKind === 'channel' ? 'selected' : ''} onClick={() => setRoomKind('channel')} type="button"><Hash size={14} /> Kanal</button><button className={roomKind === 'direct' ? 'selected' : ''} onClick={() => setRoomKind('direct')} type="button"><LockKeyhole size={14} /> Özel sohbet</button></div>
            <form onSubmit={handleCreate} className="modal-form"><label>ODA ADI<input autoFocus data-testid="input-room-name" maxLength={80} placeholder={roomKind === 'channel' ? 'ör. ortak-sohbet' : 'Yalnızca senin tanıyacağın bir ad'} value={roomName} onChange={(event) => setRoomName(event.target.value)} /></label><label>BU ODA NE İÇİN? <span className="optional">İSTEĞE BAĞLI</span><textarea data-testid="input-room-topic" maxLength={240} placeholder="Sohbetin amacını kısaca yaz…" value={topic} onChange={(event) => setTopic(event.target.value)} /></label>{formError && <div className="form-error">{formError}</div>}<button className="primary-button modal-submit" type="submit" disabled={createRoomMutation.isPending}>{createRoomMutation.isPending ? 'Oda açılıyor…' : 'Oda oluştur'} <ArrowUpRight size={15} /></button></form>
            <div className="modal-footnote"><LockKeyhole size={12} /> Oda adı ve konusu sunucuya gitmeden önce şifrelenir.</div>
          </>}
          {modal === 'join' && <>
            <div className="modal-icon"><ArrowDown size={19} /></div><p className="eyebrow">SANA BİR DAVET VAR</p><h2 id="modal-title">Davetle odaya katıl.</h2><p className="modal-intro">Oda kimliğini ve özel anahtarını içeren bağlantıyı yapıştır. Anahtar bu cihazda kalır, sunucuya gönderilmez.</p>
            <form onSubmit={handleJoin} className="modal-form"><label>ODA KİMLİĞİ VEYA DAVET BAĞLANTISI<input autoFocus data-testid="input-join-room-id" placeholder="Oda kimliğini ya da davet bağlantısını yapıştır" value={joinId} onChange={(event) => { setJoinId(event.target.value); const invite = readInvite(event.target.value); if (invite) { setJoinId(invite.roomId); setJoinKey(invite.key); } }} /></label><label>ÖZEL ODA ANAHTARI<input data-testid="input-join-room-key" type={showKey ? 'text' : 'password'} placeholder="Davet bağlantısındaki anahtar" value={joinKey} onChange={(event) => setJoinKey(event.target.value)} /></label><button className="show-key-button" type="button" onClick={() => setShowKey(!showKey)}>{showKey ? 'Anahtarı gizle' : 'Anahtarı göster'}</button>{formError && <div className="form-error">{formError}</div>}<button className="primary-button modal-submit" type="submit">Odaya katıl <ArrowUpRight size={15} /></button></form>
            <div className="modal-footnote"><ShieldCheck size={13} /> Oda kimliği yönlendirme için görünür; oda ayrıntıları anahtarla çözülür.</div>
          </>}
          {modal === 'invite' && <>
            <div className="modal-icon mint"><KeyRound size={19} /></div><p className="eyebrow">ANAHTAR SENDE</p><h2 id="modal-title">Birini davet et.</h2><p className="modal-intro">Bu bağlantıya sahip olan herkes <strong>{activeRoom?.name}</strong> odasını açabilir ve mesaj gönderebilir. Bağlantıyı herkese açık yerde paylaşma.</p>
            <div className="invite-detail"><span>ODA KİMLİĞİ</span><code>{activeRoom?.id}</code></div><div className="invite-detail"><span>DAVET BAĞLANTISI <em>özel anahtar içerir</em></span><div className="invite-copy-field"><code>{window.location.origin}{window.location.pathname}#join/{activeRoom?.id}?key={keys[activeRoom?.id || ''] ? '••••••••••••••••••••' : 'anahtar bulunamadı'}</code><button onClick={() => void copyInvite()}><Copy size={14} />{copied ? 'Kopyalandı' : 'Kopyala'}</button></div></div>
            {formError && <div className="form-error">{formError}</div>}<div className="invite-warning"><Shield size={15} /><p>Bu bağlantı oda anahtarını içerir. Bağlantıya sahip herkes mesajları okuyabilir. Sızdığından şüphelenirsen yeni bir oda oluştur.</p></div><button className="primary-button modal-submit" onClick={() => setModal(null)}>{copied ? 'Tamam — davet kopyalandı' : 'Anladım'} <BadgeCheck size={15} /></button>
          </>}
          {modal === 'settings' && <>
            <div className="modal-icon"><Settings2 size={19} /></div><p className="eyebrow">YEREL KİMLİĞİN</p><h2 id="modal-title">Sohbette nasıl görünmek istersin?</h2><p className="modal-intro">Takma adın mesajlarınla birlikte uçtan uca şifrelenir. Bu tarayıcıda saklanır; bir hesaba bağlı değildir.</p>
            <form onSubmit={saveIdentity} className="modal-form"><label>TAKMA AD<input autoFocus data-testid="input-display-alias" maxLength={40} value={draftAlias} onChange={(event) => setDraftAlias(event.target.value)} /></label><div className="settings-key-row"><div><KeyRound size={15} /><span><strong>Bu cihazdaki oda anahtarları</strong><small>{Object.keys(keys).length} anahtar yerel olarak kayıtlı</small></span></div><button type="button" onClick={() => { if (window.confirm('Bu tarayıcıdaki tüm kayıtlı oda anahtarları silinsin mi? Bu işlem geri alınamaz.')) { saveKeys({}); } }}>Anahtarları sil</button></div><button className="primary-button modal-submit" type="submit">Kimliği kaydet <ArrowUpRight size={15} /></button></form>
          </>}
          {modal === 'privacy' && <>
            <div className="modal-icon mint"><ShieldCheck size={19} /></div><p className="eyebrow">GİZLİLİKTE AÇIK VE DÜRÜST</p><h2 id="modal-title">İçerik gizli.<br /><em>Ağ izleri değil.</em></h2><p className="modal-intro">Oda adı, konu başlığı, oda türü, takma ad ve mesaj metni AES-GCM ile tarayıcında şifrelenir. Sunucuya yalnızca şifreli içerik gider; oda anahtarı sunucuya gönderilmez.</p>
            <div className="privacy-breakdown"><div><span className="privacy-check"><BadgeCheck size={14} /></span><p><strong>Sunucudan gizlenenler</strong><small>Mesajlar, takma adlar, oda adları, konu başlıkları ve oda türü.</small></p></div><div><span className="privacy-visible">●</span><p><strong>Görünür kalabilenler</strong><small>Oda kimliği, şifreli verinin boyutu ve zamanı, bağlantı/IP bilgileri. Bunları uçtan uca şifreleme gizleyemez.</small></p></div><div><span className="privacy-check"><BadgeCheck size={14} /></span><p><strong>Bu cihazda saklananlar</strong><small>Oda anahtarı ve takma ad. Anahtarlar şu an tarayıcı depolamasında; cihazına erişen zararlı yazılım veya sayfa betiği bunları tehlikeye atabilir.</small></p></div></div>
            <div className="privacy-caveat">Bu sistem anonimlik veya sansür aşma garantisi vermez. VPN, mesaj içeriğini gizlemek için şart değildir. IP adresini sohbet sunucusundan saklamak için ayrıca VPN veya Tor gibi bir ağ aracı kullanabilirsin; bu güven ilişkisini değiştirir ama anonimlik garantisi vermez. Bu sürümde ileri anahtar gizliliği ve doğrulanmış kimlik yoktur; oda anahtarını alan herkes konuşmaları okuyabilir. Ayrıca web uygulamasını sunan hizmet tarayıcıya yeni kod gönderebilir; bu nedenle yüksek riskli konuşmalar için bağımsız güvenlik denetimi yapılmadan kullanma.</div><button className="primary-button modal-submit" onClick={() => setModal(null)}>Anladım <BadgeCheck size={15} /></button>
          </>}
        </div>
      </div>}
    </div>
  );
}

function RoomNavItem({ room, active, onClick, locked }: { room: ClientRoom; active: boolean; onClick: () => void; locked: boolean }) {
  return <button className={`room-nav-item ${active ? 'active' : ''}`} onClick={onClick} data-testid={`button-room-${room.id}`}><span className={`room-nav-symbol ${room.kind}`}>{locked ? <LockKeyhole size={14} /> : room.kind === 'channel' ? <Hash size={15} /> : <MessageCircle size={14} />}</span><span className="room-nav-name">{!locked && room.kind === 'channel' ? `#${room.name}` : room.name}</span>{locked && <KeyRound className="room-key-icon" size={12} />}</button>;
}

function MessageRow({ message, payload, mine }: { message: RoomMessage; payload?: MessagePayload; mine: boolean }) {
  const date = new Date(message.createdAt);
  const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const sender = payload?.senderAlias ?? 'Gizli katılımcı';
  return <article className={`message-row ${mine ? 'mine' : ''}`} data-testid={`message-row-${message.id}`}><div className={`message-avatar ${mine ? 'mine-avatar' : ''}`}>{sender.slice(0, 1).toLocaleUpperCase('tr')}</div><div className="message-content"><div className="message-meta"><strong>{sender}</strong>{mine && <span className="you-label">SEN</span>}<time>{time}</time></div><p>{payload?.text ?? <span className="message-sealed"><LockKeyhole size={12} /> Şifreli mesaj</span>}</p></div></article>;
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
