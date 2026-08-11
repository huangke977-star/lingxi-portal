"use client";

/* eslint-disable @next/next/no-img-element */

import {
  Ban,
  BellOff,
  Check,
  Crown,
  DoorOpen,
  ImagePlus,
  LoaderCircle,
  MessageCircle,
  Search,
  Shield,
  ShieldCheck,
  Settings2,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { useRouter } from "next/navigation";
import {
  type ChatGroup,
  type ChatGroupInvitation,
  type ChatGroupJoinRequest,
  type ChatGroupSummary,
  type Friendship,
  type SocialUser,
  blockChatGroupMember,
  createChatGroup,
  dissolveChatGroup,
  getChatGroup,
  handleChatGroupReport,
  inviteChatGroupMembers,
  leaveChatGroup,
  listChatGroupInvitations,
  listChatGroupJoinRequests,
  listChatGroupReports,
  listChatGroups,
  removeChatGroupMember,
  requestChatGroupJoin,
  respondChatGroupInvitation,
  respondChatGroupJoinRequest,
  searchSocialUsers,
  searchChatGroups,
  transferChatGroupOwner,
  unblockChatGroupMember,
  updateChatGroup,
  updateChatGroupAlias,
  updateChatGroupMember,
  uploadChatGroupAvatar,
} from "@/lib/social-api";

type ManagerView = "mine" | "invites" | "search" | "create" | "detail";

export function ChatGroupManager({
  accessToken,
  friendships,
  initialGroupId,
  onChanged,
  onClose,
  onOpenConversation,
}: {
  accessToken: string;
  friendships: Friendship[];
  initialGroupId: number | null;
  onChanged: () => Promise<void> | void;
  onClose: () => void;
  onOpenConversation: (conversationId: number) => void;
}) {
  const router = useRouter();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [view, setView] = useState<ManagerView>(initialGroupId ? "detail" : "mine");
  const [groups, setGroups] = useState<ChatGroupSummary[]>([]);
  const [invitations, setInvitations] = useState<ChatGroupInvitation[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ChatGroup | null>(null);
  const [joinRequests, setJoinRequests] = useState<ChatGroupJoinRequest[]>([]);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<ChatGroupSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [createName, setCreateName] = useState("");
  const [createTemporary, setCreateTemporary] = useState(false);
  const [createTtl, setCreateTtl] = useState(7);
  const [createJoinMode, setCreateJoinMode] = useState<"approval" | "invite_only">("approval");
  const [inviteSelection, setInviteSelection] = useState<Set<number>>(new Set());
  const [inviteSearchText, setInviteSearchText] = useState("");
  const [inviteSearchResults, setInviteSearchResults] = useState<SocialUser[]>([]);
  const [isInviteSearchBusy, setIsInviteSearchBusy] = useState(false);
  const [isMemberManagementOpen, setIsMemberManagementOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [alias, setAlias] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  const refreshLists = useCallback(async () => {
    const [groupResult, invitationResult] = await Promise.all([
      listChatGroups(accessToken),
      listChatGroupInvitations(accessToken),
    ]);
    setGroups(groupResult.items);
    setInvitations(invitationResult.items);
  }, [accessToken]);

  const openGroup = useCallback(async (groupId: number) => {
    setBusyKey(`group:${groupId}`);
    try {
      const group = await getChatGroup(accessToken, groupId);
      setSelectedGroup(group);
      setGroupName(group.name);
      setAnnouncement(group.announcement);
      setAlias(group.currentAlias ?? "");
      setAvatarUrl(group.avatarUrl?.startsWith("http") ? group.avatarUrl : "");
      setInviteSelection(new Set());
      setInviteSearchText("");
      setInviteSearchResults([]);
      setIsMemberManagementOpen(false);
      setView("detail");
      if (group.canManage) {
        const requests = await listChatGroupJoinRequests(accessToken, groupId);
        setJoinRequests(requests.items);
      } else {
        setJoinRequests([]);
      }
    } catch (groupError) {
      setError(messageOf(groupError, "群聊读取失败。"));
    } finally {
      setBusyKey("");
    }
  }, [accessToken]);

  useEffect(() => {
    let active = true;
    // Opening the modal starts one external data synchronization cycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshLists()
      .then(async () => {
        if (active && initialGroupId) await openGroup(initialGroupId);
      })
      .catch((loadError) => { if (active) setError(messageOf(loadError, "群聊列表读取失败。")); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [initialGroupId, openGroup, refreshLists]);

  const activeMembers = useMemo(
    () => selectedGroup?.members.filter((member) => member.status === "active") ?? [],
    [selectedGroup],
  );
  const blockedMembers = selectedGroup?.members.filter((member) => member.status === "blocked") ?? [];
  const availableInvitees = useMemo(() => {
    const existing = new Set(activeMembers.map((member) => member.user.id));
    return friendships.map((friendship) => friendship.user).filter((candidate) => !existing.has(candidate.id));
  }, [activeMembers, friendships]);

  const searchableInvitees = useMemo(() => {
    const existing = new Set(activeMembers.map((member) => member.user.id));
    const candidates = inviteSearchText.trim() ? inviteSearchResults : availableInvitees;
    return candidates.filter((candidate) => !existing.has(candidate.id));
  }, [activeMembers, availableInvitees, inviteSearchResults, inviteSearchText]);

  async function run(key: string, action: () => Promise<void>, success: string) {
    setBusyKey(key);
    setError("");
    try {
      await action();
      setNotice(success);
      await refreshLists();
      await onChanged();
    } catch (actionError) {
      setError(messageOf(actionError, "操作失败。"));
    } finally {
      setBusyKey("");
    }
  }

  async function submitCreate() {
    if (createName.trim().length < 2) {
      setError("群名称至少需要 2 个字符。");
      return;
    }
    await run("create", async () => {
      const group = await createChatGroup(accessToken, {
        name: createName.trim(),
        temporary: createTemporary,
        ttlDays: createTtl,
        joinMode: createJoinMode,
      });
      setCreateName("");
      await openGroup(group.id);
    }, "群聊已创建。");
  }

  async function searchGroupsNow() {
    setBusyKey("search");
    try {
      setSearchResults((await searchChatGroups(accessToken, searchText.trim())).items);
    } catch (searchError) {
      setError(messageOf(searchError, "群聊搜索失败。"));
    } finally {
      setBusyKey("");
    }
  }

  async function saveGroup() {
    if (!selectedGroup) return;
    await run("save", async () => {
      const updated = await updateChatGroup(accessToken, selectedGroup.id, {
        name: groupName.trim(),
        announcement: announcement.trim(),
        joinMode: selectedGroup.joinMode,
        ...(avatarUrl.trim() ? { avatarUrl: avatarUrl.trim() } : {}),
      });
      setSelectedGroup(updated);
    }, "群资料已更新。");
  }

  async function saveAlias() {
    if (!selectedGroup) return;
    await run("alias", async () => {
      setSelectedGroup(await updateChatGroupAlias(accessToken, selectedGroup.id, alias));
    }, "群内昵称已更新。");
  }

  async function uploadAvatar(file: File | undefined) {
    if (!selectedGroup || !file) return;
    await run("avatar", async () => {
      const updated = await uploadChatGroupAvatar(accessToken, selectedGroup.id, file);
      setSelectedGroup(updated);
      setAvatarUrl("");
    }, "群头像已更新。");
  }

  async function inviteSelected() {
    if (!selectedGroup || !inviteSelection.size) return;
    await run("invite", async () => {
      await inviteChatGroupMembers(accessToken, selectedGroup.id, Array.from(inviteSelection));
      setInviteSelection(new Set());
    }, "群邀请已发出。");
  }

  async function searchInviteesNow() {
    const keyword = inviteSearchText.trim();
    if (keyword.length < 2) {
      setError("搜索关键词至少需要 2 个字符。");
      return;
    }
    setIsInviteSearchBusy(true);
    setError("");
    try {
      const result = await searchSocialUsers(accessToken, keyword, 20);
      setInviteSearchResults(result.items);
    } catch (searchError) {
      setError(messageOf(searchError, "用户搜索失败。"));
    } finally {
      setIsInviteSearchBusy(false);
    }
  }

  function openMemberProfile(username: string) {
    onClose();
    router.push(`/users/${encodeURIComponent(username)}`);
  }

  async function refreshCurrentGroup() {
    if (selectedGroup) await openGroup(selectedGroup.id);
  }

  return <div className="chat-group-manager-backdrop" onClick={onClose} role="presentation">
    <section aria-modal="true" className="chat-group-manager" onClick={(event) => event.stopPropagation()} role="dialog">
      <header>
        <span><Users aria-hidden="true" size={19} /><strong>群聊</strong></span>
        <button aria-label="关闭群聊管理" onClick={onClose} type="button"><X aria-hidden="true" size={18} /></button>
      </header>
      <div className="chat-group-manager-body">
        <nav aria-label="群聊功能">
          <button className={view === "mine" || view === "detail" ? "active" : ""} onClick={() => setView("mine")} type="button"><MessageCircle aria-hidden="true" size={16} />我的群聊</button>
          <button className={view === "invites" ? "active" : ""} onClick={() => setView("invites")} type="button"><UserPlus aria-hidden="true" size={16} />群邀请{invitations.length ? <b>{invitations.length}</b> : null}</button>
          <button className={view === "search" ? "active" : ""} onClick={() => setView("search")} type="button"><Search aria-hidden="true" size={16} />查找群聊</button>
          <button className={view === "create" ? "active" : ""} onClick={() => setView("create")} type="button"><Users aria-hidden="true" size={16} />创建群聊</button>
        </nav>
        <main>
          {isLoading ? <div className="chat-group-state"><LoaderCircle aria-hidden="true" className="spin" size={20} />正在读取群聊。</div> : null}
          {!isLoading && view === "mine" ? <GroupList groups={groups} busyKey={busyKey} empty="还没有加入群聊。" onOpen={openGroup} /> : null}
          {!isLoading && view === "invites" ? <div className="chat-group-list">
            {invitations.map((invitation) => <article className="chat-group-invitation" key={invitation.id}>
              <GroupAvatar group={invitation.group} />
              <span><strong>{invitation.group.name}</strong><small>{invitation.inviter.nickname} 邀请你加入 · {invitation.group.memberCount} 人</small></span>
              <div><button disabled={Boolean(busyKey)} onClick={() => void run(`invite:${invitation.id}`, async () => {
                const result = await respondChatGroupInvitation(accessToken, invitation.id, "accepted");
                if (result.group) await openGroup(result.group.id);
              }, "已加入群聊。")} type="button"><Check aria-hidden="true" size={14} />接受</button><button disabled={Boolean(busyKey)} onClick={() => void run(`invite:${invitation.id}`, async () => { await respondChatGroupInvitation(accessToken, invitation.id, "declined"); }, "已拒绝群邀请。")} type="button"><X aria-hidden="true" size={14} />拒绝</button></div>
            </article>)}
            {!invitations.length ? <div className="chat-group-state">当前没有待处理群邀请。</div> : null}
          </div> : null}
          {!isLoading && view === "search" ? <section className="chat-group-search-pane">
            <form onSubmit={(event) => { event.preventDefault(); void searchGroupsNow(); }}><Search aria-hidden="true" size={16} /><input maxLength={60} onChange={(event) => setSearchText(event.target.value)} placeholder="输入群名称" value={searchText} /><button disabled={busyKey === "search"} type="submit">搜索</button></form>
            <div className="chat-group-list">{searchResults.map((group) => <article key={group.id}><GroupAvatar group={group} /><span><strong>{group.name}</strong><small>{group.memberCount}/{group.memberLimit} 人{group.temporary && group.expiresAt ? ` · ${formatExpiry(group.expiresAt)}` : ""}</small></span>{group.currentMemberRole ? <button onClick={() => void openGroup(group.id)} type="button">打开</button> : <button disabled={Boolean(busyKey)} onClick={() => void run(`join:${group.id}`, async () => { await requestChatGroupJoin(accessToken, group.id); }, "入群申请已提交。")} type="button">申请加入</button>}</article>)}</div>
          </section> : null}
          {!isLoading && view === "create" ? <section className="chat-group-form">
            <label><span>群名称</span><input maxLength={60} onChange={(event) => setCreateName(event.target.value)} placeholder="给群聊起个名字" value={createName} /></label>
            <div className="chat-group-form-split"><label><span>入群方式</span><select onChange={(event) => setCreateJoinMode(event.target.value as "approval" | "invite_only")} value={createJoinMode}><option value="approval">申请后加入</option><option value="invite_only">仅邀请加入</option></select></label><label className="chat-group-switch"><span>临时群聊</span><input checked={createTemporary} onChange={(event) => setCreateTemporary(event.target.checked)} type="checkbox" /></label>{createTemporary ? <label><span>保留天数</span><input max={30} min={1} onChange={(event) => setCreateTtl(Number(event.target.value))} type="number" value={createTtl} /></label> : null}</div>
            <footer><button disabled={busyKey === "create"} onClick={() => void submitCreate()} type="button">{busyKey === "create" ? "创建中" : "创建群聊"}</button></footer>
          </section> : null}
          {!isLoading && view === "detail" && selectedGroup ? <section className="chat-group-detail">
            <div className="chat-group-detail-identity"><GroupAvatar group={selectedGroup} large /><span><strong>{selectedGroup.name}</strong><small>{selectedGroup.memberCount}/{selectedGroup.memberLimit} 人 · {groupRoleLabel(selectedGroup.currentMemberRole)}{selectedGroup.temporary && selectedGroup.expiresAt ? ` · ${formatExpiry(selectedGroup.expiresAt)}` : ""}</small></span><button onClick={() => onOpenConversation(selectedGroup.conversationId)} type="button"><MessageCircle aria-hidden="true" size={15} />进入群聊</button></div>
            {selectedGroup.announcement ? <p className="chat-group-announcement">{selectedGroup.announcement}</p> : null}
            <div className="chat-group-detail-grid">
              <section>
                <h3>我的群名片</h3>
                <label><span>群内昵称</span><div><input maxLength={32} onChange={(event) => setAlias(event.target.value)} placeholder="跟随账号昵称" value={alias} /><button disabled={busyKey === "alias"} onClick={() => void saveAlias()} type="button">保存</button></div></label>
              </section>
              {selectedGroup.canManage ? <section>
                <h3>群资料</h3>
                <label><span>名称</span><input maxLength={60} onChange={(event) => setGroupName(event.target.value)} value={groupName} /></label>
                <label><span>公告</span><textarea maxLength={1000} onChange={(event) => setAnnouncement(event.target.value)} rows={3} value={announcement} /></label>
                <label><span>头像地址</span><div><input onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://" value={avatarUrl} /><button aria-label="上传群头像" onClick={() => avatarInputRef.current?.click()} title="上传群头像" type="button"><ImagePlus aria-hidden="true" size={16} /></button></div></label>
                <input accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => void uploadAvatar(event.target.files?.[0])} ref={avatarInputRef} type="file" />
                <button disabled={busyKey === "save" || busyKey === "avatar"} onClick={() => void saveGroup()} type="button">保存群资料</button>
              </section> : null}
            </div>
            {selectedGroup.canManage ? <section className="chat-group-management-section"><h3>邀请成员</h3><GroupInviteSelector candidates={searchableInvitees} isSearching={isInviteSearchBusy} query={inviteSearchText} selected={inviteSelection} setQuery={setInviteSearchText} setSelected={setInviteSelection} onSearch={() => void searchInviteesNow()} /><button disabled={!inviteSelection.size || busyKey === "invite"} onClick={() => void inviteSelected()} type="button"><UserPlus aria-hidden="true" size={14} />发送邀请{inviteSelection.size ? `（${inviteSelection.size}）` : ""}</button></section> : null}
            {selectedGroup.canManage && joinRequests.length ? <section className="chat-group-management-section"><h3>入群申请 <b>{joinRequests.length}</b></h3><div className="chat-group-request-list">{joinRequests.map((request) => <article key={request.id}><UserAvatar user={request.user} /><span><strong>{request.user.nickname}</strong><small>{request.note || "未填写申请说明"}</small></span><button onClick={() => void run(`request:${request.id}`, async () => { await respondChatGroupJoinRequest(accessToken, selectedGroup.id, request.id, "approved"); await refreshCurrentGroup(); }, "已同意入群申请。")} type="button"><Check aria-hidden="true" size={14} /></button><button onClick={() => void run(`request:${request.id}`, async () => { await respondChatGroupJoinRequest(accessToken, selectedGroup.id, request.id, "rejected"); await refreshCurrentGroup(); }, "已拒绝入群申请。")} type="button"><X aria-hidden="true" size={14} /></button></article>)}</div></section> : null}
            <section className="chat-group-management-section"><h3>群成员 <b>{activeMembers.length}</b>{selectedGroup.canManage ? <button aria-expanded={isMemberManagementOpen} aria-label="成员管理" className="chat-group-member-manage-toggle" onClick={() => setIsMemberManagementOpen((current) => !current)} title="成员管理" type="button"><Settings2 aria-hidden="true" size={15} /></button> : null}</h3><div className="chat-group-member-avatar-grid">{activeMembers.map((member) => <button aria-label={`查看 ${member.alias || member.user.nickname} 的主页`} className="chat-group-member-avatar-button" key={member.user.id} onClick={() => openMemberProfile(member.user.username)} title={`${member.alias || member.user.nickname} · ${groupRoleLabel(member.role)}`} type="button"><UserAvatar user={member.user} /></button>)}</div>{isMemberManagementOpen && selectedGroup.canManage ? <div className="chat-group-member-list">{activeMembers.map((member) => <article key={member.user.id}><button aria-label={`查看 ${member.alias || member.user.nickname} 的主页`} className="chat-group-member-avatar-button" onClick={() => openMemberProfile(member.user.username)} title="查看主页" type="button"><UserAvatar user={member.user} /></button><span><strong>{member.alias || member.user.nickname}</strong><small>@{member.user.username}{member.mutedUntil && new Date(member.mutedUntil) > new Date() ? " · 已禁言" : ""}</small></span><i className={member.role}>{member.role === "owner" ? <Crown aria-hidden="true" size={14} /> : member.role === "admin" ? <ShieldCheck aria-hidden="true" size={14} /> : <Shield aria-hidden="true" size={14} />}{groupRoleLabel(member.role)}</i>{selectedGroup.canManage && !member.isSelf && member.role !== "owner" ? <div className="chat-group-member-actions">{selectedGroup.currentMemberRole === "owner" ? <button onClick={() => void run(`role:${member.user.id}`, async () => { setSelectedGroup(await updateChatGroupMember(accessToken, selectedGroup.id, member.user.id, { role: member.role === "admin" ? "member" : "admin" })); }, member.role === "admin" ? "已取消管理员。" : "已设为管理员。")} title={member.role === "admin" ? "取消管理员" : "设为管理员"} type="button"><ShieldCheck aria-hidden="true" size={14} /></button> : null}<button onClick={() => void run(`mute:${member.user.id}`, async () => { setSelectedGroup(await updateChatGroupMember(accessToken, selectedGroup.id, member.user.id, { mutedMinutes: member.mutedUntil && new Date(member.mutedUntil) > new Date() ? 0 : 60 })); }, member.mutedUntil && new Date(member.mutedUntil) > new Date() ? "已解除禁言。" : "已禁言 1 小时。")} title="切换禁言" type="button"><BellOff aria-hidden="true" size={14} /></button>{selectedGroup.currentMemberRole === "owner" ? <button onClick={() => void run(`transfer:${member.user.id}`, async () => { setSelectedGroup(await transferChatGroupOwner(accessToken, selectedGroup.id, member.user.id)); }, "群主已转让。")} title="转让群主" type="button"><Crown aria-hidden="true" size={14} /></button> : null}<button onClick={() => void run(`remove:${member.user.id}`, async () => { setSelectedGroup(await removeChatGroupMember(accessToken, selectedGroup.id, member.user.id)); }, "成员已移出群聊。")} title="移出群聊" type="button"><DoorOpen aria-hidden="true" size={14} /></button><button className="danger" onClick={() => void run(`block:${member.user.id}`, async () => { setSelectedGroup(await blockChatGroupMember(accessToken, selectedGroup.id, member.user.id)); }, "成员已拉黑。")} title="拉黑成员" type="button"><Ban aria-hidden="true" size={14} /></button></div> : null}</article>)}</div> : null}</section>
            {selectedGroup.canManage && blockedMembers.length ? <section className="chat-group-management-section"><h3>群黑名单 <b>{blockedMembers.length}</b></h3><div className="chat-group-member-list">{blockedMembers.map((member) => <article key={member.user.id}><UserAvatar user={member.user} /><span><strong>{member.user.nickname}</strong><small>@{member.user.username}</small></span><button onClick={() => void run(`unblock:${member.user.id}`, async () => { setSelectedGroup(await unblockChatGroupMember(accessToken, selectedGroup.id, member.user.id)); }, "已解除群聊拉黑。")} type="button">解除拉黑</button></article>)}</div></section> : null}
            {selectedGroup.canManage ? <GroupReports accessToken={accessToken} groupId={selectedGroup.id} run={run} /> : null}
            <footer className="chat-group-danger-zone">{selectedGroup.currentMemberRole === "owner" ? <button className="danger" disabled={Boolean(busyKey)} onClick={() => void run("dissolve", async () => { await dissolveChatGroup(accessToken, selectedGroup.id); setSelectedGroup(null); setView("mine"); }, "群聊已解散。")} type="button"><Trash2 aria-hidden="true" size={14} />解散群聊</button> : <button className="danger" disabled={Boolean(busyKey)} onClick={() => void run("leave", async () => { await leaveChatGroup(accessToken, selectedGroup.id); setSelectedGroup(null); setView("mine"); }, "已退出群聊。")} type="button"><DoorOpen aria-hidden="true" size={14} />退出群聊</button>}</footer>
          </section> : null}
        </main>
      </div>
    </section>
    <AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </div>;
}

function GroupReports({ accessToken, groupId, run }: { accessToken: string; groupId: number; run: (key: string, action: () => Promise<void>, success: string) => Promise<void> }) {
  const [reports, setReports] = useState<Awaited<ReturnType<typeof listChatGroupReports>>["items"]>([]);
  useEffect(() => { void listChatGroupReports(accessToken, groupId, "pending").then((result) => setReports(result.items)).catch(() => undefined); }, [accessToken, groupId]);
  if (!reports.length) return null;
  return <section className="chat-group-management-section"><h3>待处理举报 <b>{reports.length}</b></h3><div className="chat-group-report-list">{reports.map((report) => <article key={report.id}><span><strong>{report.reporter.nickname} 举报了 {report.message.sender.nickname}</strong><q>{report.message.body || "附件消息"}</q><small>{report.detail || report.reason}</small></span><button onClick={() => void run(`report:${report.id}`, async () => { await handleChatGroupReport(accessToken, report.id, { status: "resolved", deleteMessage: true, resolution: "群管理员已删除消息" }); setReports((current) => current.filter((item) => item.id !== report.id)); }, "举报已处理，消息已删除。")} type="button">处理</button><button onClick={() => void run(`report:${report.id}`, async () => { await handleChatGroupReport(accessToken, report.id, { status: "rejected", resolution: "未发现违规" }); setReports((current) => current.filter((item) => item.id !== report.id)); }, "举报已驳回。")} type="button">驳回</button></article>)}</div></section>;
}

function GroupList({ groups, busyKey, empty, onOpen }: { groups: ChatGroupSummary[]; busyKey: string; empty: string; onOpen: (id: number) => Promise<void> }) {
  return <div className="chat-group-list">{groups.map((group) => <button disabled={busyKey === `group:${group.id}`} key={group.id} onClick={() => void onOpen(group.id)} type="button"><GroupAvatar group={group} /><span><strong>{group.name}</strong><small>{group.memberCount} 人 · {groupRoleLabel(group.currentMemberRole)}{group.temporary && group.expiresAt ? ` · ${formatExpiry(group.expiresAt)}` : ""}</small></span>{busyKey === `group:${group.id}` ? <LoaderCircle aria-hidden="true" className="spin" size={15} /> : <MessageCircle aria-hidden="true" size={15} />}</button>)}{!groups.length ? <div className="chat-group-state">{empty}</div> : null}</div>;
}

function GroupInviteSelector({
  candidates,
  isSearching,
  onSearch,
  query,
  selected,
  setQuery,
  setSelected,
}: {
  candidates: SocialUser[];
  isSearching: boolean;
  onSearch: () => void;
  query: string;
  selected: Set<number>;
  setQuery: (query: string) => void;
  setSelected: (next: Set<number>) => void;
}) {
  return <section className="chat-group-friend-selector"><form className="chat-group-invite-search" onSubmit={(event) => { event.preventDefault(); onSearch(); }}><Search aria-hidden="true" size={15} /><input maxLength={32} onChange={(event) => setQuery(event.target.value)} placeholder="搜索昵称或用户名" value={query} /><button disabled={isSearching} type="submit">{isSearching ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : "搜索"}</button></form><div>{candidates.map((candidate) => <button aria-pressed={selected.has(candidate.id)} key={candidate.id} onClick={() => { const next = new Set(selected); if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id); setSelected(next); }} type="button"><UserAvatar user={candidate} /><span><strong>{candidate.nickname}</strong><small>@{candidate.username}</small></span><i>{selected.has(candidate.id) ? <Check aria-hidden="true" size={12} /> : null}</i></button>)}</div>{!candidates.length ? <small>{query.trim() ? "没有找到可邀请用户。" : "暂无可邀请好友，可搜索昵称或用户名邀请其他用户。"}</small> : null}</section>;
}

function GroupAvatar({ group, large = false }: { group: Pick<ChatGroupSummary, "name" | "avatarUrl">; large?: boolean }) {
  return <span className={`chat-group-avatar${large ? " large" : ""}`}>{group.avatarUrl ? <img alt="" src={group.avatarUrl} /> : fallbackText(group.name)}</span>;
}

function UserAvatar({ user }: { user: { nickname: string; avatarUrl: string | null } }) {
  return <span className="chat-user-avatar">{user.avatarUrl ? <img alt="" src={user.avatarUrl} /> : fallbackText(user.nickname)}</span>;
}

function groupRoleLabel(role: ChatGroupSummary["currentMemberRole"] | "owner" | "admin" | "member"): string {
  if (role === "owner") return "群主";
  if (role === "admin") return "管理员";
  return "成员";
}

function formatExpiry(value: string): string {
  return `${new Date(value).toLocaleString("zh-CN", { hour12: false })} 到期`;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function fallbackText(name: string): string {
  return Array.from(name.trim()).slice(-2).join("").toUpperCase();
}
