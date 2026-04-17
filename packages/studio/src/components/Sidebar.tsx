import { useEffect, useMemo, useState } from "react";
import { useApi } from "../hooks/use-api";
import type { SSEMessage } from "../hooks/use-sse";
import { shouldRefetchBookCollections, shouldRefetchDaemonStatus } from "../hooks/use-book-activity";
import type { TFunction } from "../hooks/use-i18n";
import { useChatStore } from "../store/chat";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Book,
  Settings,
  Terminal,
  Plus,
  ScrollText,
  Boxes,
  Zap,
  Wand2,
  FileInput,
  TrendingUp,
  Stethoscope,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
}

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toBookCreate: () => void;
  toServices: () => void;
  toDaemon: () => void;
  toLogs: () => void;
  toGenres: () => void;
  toStyle: () => void;
  toImport: () => void;
  toRadar: () => void;
  toDoctor: () => void;
}

export function Sidebar({ nav, activePage, sse, t }: {
  nav: Nav;
  activePage: string;
  sse: { messages: ReadonlyArray<SSEMessage> };
  t: TFunction;
}) {
  const { data, refetch: refetchBooks } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: daemon, refetch: refetchDaemon } = useApi<{ running: boolean }>("/daemon");
  const sessions = useChatStore((s) => s.sessions);
  const sessionIdsByBook = useChatStore((s) => s.sessionIdsByBook);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);
  const loadSessionList = useChatStore((s) => s.loadSessionList);
  const loadSessionDetail = useChatStore((s) => s.loadSessionDetail);
  const activateSession = useChatStore((s) => s.activateSession);
  const createSession = useChatStore((s) => s.createSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const [expandedBooks, setExpandedBooks] = useState<Record<string, boolean>>({});
  const [renameTarget, setRenameTarget] = useState<{ sessionId: string; currentTitle: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ sessionId: string; title: string } | null>(null);

  const books = data?.books ?? [];

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;
    if (shouldRefetchBookCollections(recent)) {
      refetchBooks();
    }
    if (shouldRefetchDaemonStatus(recent)) {
      refetchDaemon();
    }
  }, [refetchBooks, refetchDaemon, sse.messages]);

  useEffect(() => {
    for (const book of books) {
      void loadSessionList(book.id);
    }
  }, [bookDataVersion, books, loadSessionList]);

  useEffect(() => {
    if (!activePage.startsWith("book:")) return;
    const activeBookId = activePage.slice("book:".length);
    setExpandedBooks((prev) => ({ ...prev, [activeBookId]: true }));
  }, [activePage]);

  const sessionsByBook = useMemo(
    () =>
      Object.fromEntries(
        books.map((book) => [
          book.id,
          (sessionIdsByBook[book.id] ?? [])
            .map((sessionId) => sessions[sessionId])
            .filter(Boolean),
        ]),
      ) as Record<string, Array<(typeof sessions)[string]>>,
    [books, sessionIdsByBook, sessions],
  );

  const openSession = (bookId: string, sessionId: string) => {
    activateSession(sessionId);
    nav.toBook(bookId);
    void loadSessionDetail(sessionId);
  };

  const handleCreateSession = async (bookId: string) => {
    const sessionId = await createSession(bookId);
    setExpandedBooks((prev) => ({ ...prev, [bookId]: true }));
    nav.toBook(bookId);
    await loadSessionDetail(sessionId);
  };

  const handleRenameConfirm = async () => {
    if (!renameTarget) return;
    const nextTitle = renameValue.trim();
    if (!nextTitle) return;
    await renameSession(renameTarget.sessionId, nextTitle);
    setRenameTarget(null);
    setRenameValue("");
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await deleteSession(deleteTarget.sessionId);
    setDeleteTarget(null);
  };

  return (
    <aside className="w-[260px] shrink-0 border-r border-border bg-background/80 backdrop-blur-md flex flex-col h-full overflow-hidden select-none">
      {/* Logo Area */}
      <div className="px-6 py-8">
        <button
          onClick={nav.toDashboard}
          className="group flex items-center gap-2 hover:opacity-80 transition-all duration-300"
        >
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20 group-hover:scale-105 transition-transform">
            <ScrollText size={18} />
          </div>
          <div className="flex flex-col">
            <span className="font-serif text-xl leading-none italic font-medium">InkOS</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold mt-1">Studio</span>
          </div>
        </button>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-6">
        {/* Books Section */}
        <div>
          <div className="px-3 mb-3 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              {t("nav.books")}
            </span>
            <button
              onClick={nav.toBookCreate}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
            >
              <Plus size={12} />
              <span>{t("nav.newBook")}</span>
            </button>
          </div>

          <div className="space-y-1">
            {books.map((book) => {
              const bookSessions = sessionsByBook[book.id] ?? [];
              const isActiveBook = activePage === `book:${book.id}`;
              const isExpanded = expandedBooks[book.id] ?? isActiveBook;
              return (
                <div key={book.id} className="space-y-1">
                  <div
                    className={`group flex items-center gap-2 rounded-lg px-2 py-1 ${
                      isActiveBook ? "bg-primary/8" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedBooks((prev) => ({ ...prev, [book.id]: !isExpanded }))}
                      className="h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:bg-secondary/70 hover:text-foreground transition-colors"
                    >
                      <ChevronRight
                        size={14}
                        className={`mx-auto transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      />
                    </button>
                    <button
                      onClick={() => nav.toBook(book.id)}
                      className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-sm transition-all duration-200 ${
                        isActiveBook
                          ? "text-primary font-medium"
                          : "text-foreground font-medium hover:text-foreground"
                      }`}
                    >
                      <Book size={16} className={isActiveBook ? "text-primary" : "text-muted-foreground group-hover:text-foreground"} />
                      <span className="truncate flex-1 text-left">{book.title}</span>
                      {book.chaptersWritten > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary transition-colors">
                          {book.chaptersWritten}
                        </span>
                      )}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="ml-8 space-y-1 border-l border-border/40 pl-3">
                      {bookSessions.map((session) => {
                        const isActiveSession = isActiveBook && activeSessionId === session.sessionId;
                        const label = getSessionLabel(session.sessionId, session.title);
                        return (
                          <div
                            key={session.sessionId}
                            className={`flex items-center gap-1 rounded-md px-1 py-0.5 ${
                              isActiveSession ? "bg-primary/10" : "hover:bg-secondary/50"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => openSession(book.id, session.sessionId)}
                              className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                                isActiveSession
                                  ? "text-primary"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  isActiveSession
                                    ? "bg-primary"
                                    : session.isStreaming
                                      ? "bg-emerald-500"
                                      : "bg-border"
                                }`}
                              />
                              <span className="truncate flex-1">{label}</span>
                              {session.isStreaming ? (
                                <Loader2 size={12} className="animate-spin text-emerald-500" />
                              ) : isActiveSession ? (
                                <span className="text-primary">●</span>
                              ) : null}
                            </button>

                            <DropdownMenu>
                              <DropdownMenuTrigger className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/70 hover:text-foreground transition-colors">
                                <MoreHorizontal size={14} />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent side="right" align="start" className="w-36">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setRenameTarget({ sessionId: session.sessionId, currentTitle: label });
                                    setRenameValue(session.title ?? "");
                                  }}
                                >
                                  <Pencil size={14} />
                                  <span>改名</span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => setDeleteTarget({ sessionId: session.sessionId, title: label })}
                                >
                                  <Trash2 size={14} />
                                  <span>删除</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => void handleCreateSession(book.id)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-muted-foreground/60 hover:text-primary hover:bg-primary/5 transition-all"
                      >
                        <Plus size={12} />
                        <span>新建会话</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {books.length === 0 && (
              <div className="px-3 py-6 text-xs text-muted-foreground/70 italic text-center border border-dashed border-border rounded-lg">
                {t("dash.noBooks")}
              </div>
            )}
          </div>
        </div>

        {/* System Section */}
        <div>
          <div className="px-3 mb-3">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              {t("nav.system")}
            </span>
          </div>
          <div className="space-y-1">
            <SidebarItem
              label={t("create.genre")}
              icon={<Boxes size={16} />}
              active={activePage === "genres"}
              onClick={nav.toGenres}
            />
            <SidebarItem
              label={t("nav.config")}
              icon={<Settings size={16} />}
              active={activePage === "services"}
              onClick={nav.toServices}
            />
{/*            <SidebarItem
              label={t("nav.daemon")}
              icon={<Zap size={16} />}
              active={activePage === "daemon"}
              onClick={nav.toDaemon}
              badge={daemon?.running ? t("nav.running") : undefined}
              badgeColor={daemon?.running ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"}
            />*/}
            <SidebarItem
              label={t("nav.logs")}
              icon={<Terminal size={16} />}
              active={activePage === "logs"}
              onClick={nav.toLogs}
            />
          </div>
        </div>

        {/* Tools Section */}
        <div>
          <div className="px-3 mb-3">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              {t("nav.tools")}
            </span>
          </div>
          <div className="space-y-1">
            <SidebarItem
              label={t("nav.style")}
              icon={<Wand2 size={16} />}
              active={activePage === "style"}
              onClick={nav.toStyle}
            />
            <SidebarItem
              label={t("nav.import")}
              icon={<FileInput size={16} />}
              active={activePage === "import"}
              onClick={nav.toImport}
            />
            <SidebarItem
              label={t("nav.radar")}
              icon={<TrendingUp size={16} />}
              active={activePage === "radar"}
              onClick={nav.toRadar}
            />
            <SidebarItem
              label={t("nav.doctor")}
              icon={<Stethoscope size={16} />}
              active={activePage === "doctor"}
              onClick={nav.toDoctor}
            />
          </div>
        </div>
      </div>

      {/* Footer / Status Area — only show when agent is online */}
      {daemon?.running && (
        <div className="p-4 border-t border-border bg-secondary/40">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border shadow-sm">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wider">
              {t("nav.agentOnline")}
            </span>
          </div>
        </div>
      )}

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameValue("");
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
            <DialogDescription>
              手动标题会覆盖自动生成标题，后续不再被 AI 改写。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="session-rename-input">
              会话标题
            </label>
            <input
              id="session-rename-input"
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleRenameConfirm();
                }
              }}
              placeholder="输入新标题"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setRenameTarget(null);
                setRenameValue("");
              }}
              className="px-4 py-2 text-sm font-medium rounded-xl bg-secondary text-foreground hover:bg-secondary/80 transition-all border border-border/50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleRenameConfirm()}
              disabled={!renameValue.trim()}
              className="px-4 py-2 text-sm font-bold rounded-xl bg-primary text-primary-foreground transition-all disabled:opacity-40"
            >
              保存
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除会话"
        message={`确认删除“${deleteTarget?.title ?? ""}”吗？该操作只删除这条会话，不影响书籍内容。`}
        confirmLabel="删除"
        cancelLabel="取消"
        variant="danger"
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  );
}

function getSessionLabel(sessionId: string, title: string | null): string {
  if (title) return title;
  const rawTs = Number(sessionId.split("-")[0]);
  if (!Number.isFinite(rawTs)) return "新会话";
  const formatted = new Date(rawTs).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `新会话 · ${formatted}`;
}

function SidebarItem({ label, icon, active, onClick, badge, badgeColor }: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
        active
          ? "bg-secondary text-foreground font-medium shadow-sm border border-border"
          : "text-foreground font-medium hover:text-foreground hover:bg-secondary/50"
      }`}
    >
      <span className={`transition-colors ${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tight ${badgeColor}`}>
          {badge}
        </span>
      )}
    </button>
  );
}
