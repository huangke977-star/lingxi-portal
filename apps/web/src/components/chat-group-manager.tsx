"use client";

/* eslint-disable @next/next/no-img-element */

import {
  Ban,
  Bell,
  BellOff,
  Check,
  Crown,
  DoorOpen,
  Download,
  ImagePlus,
  LoaderCircle,
  MessageCircle,
  Save,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { useRouter } from "next/navigation";
import { resolveApiUrl } from "@/lib/auth-api";
import {
  type ChatGroup,
  type ChatGroupMember,
  type ChatGroupInvitation,
  type ChatGroupJoinRequest,
  type ChatGroupSummary,
  type ChatAttachment,
  type Friendship,
  type SocialUser,
  blockChatGroupMember,
  createChatGroup,
  dissolveChatGroup,
  downloadChatAttachment,
  downloadChatAttachmentThumbnail,
  getChatGroup,
  handleChatGroupReport,
  inviteChatGroupMembers,
  leaveChatGroup,
  listChatGroupApprovals,
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
  initialView,
  onChanged,
  onClose,
  onOpenConversation,
}: {
  accessToken: string;
  friendships: Friendship[];
  initialGroupId: number | null;
  initialView?: "mine" | "invites";
  onChanged: () => Promise<void> | void;
  onClose: () => void;
  onOpenConversation: (conversationId: number) => void;
}) {
  const router = useRouter();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [view, setView] = useState<ManagerView>(initialGroupId ? "detail" : initialView ?? "mine");
  const [groups, setGroups] = useState<ChatGroupSummary[]>([]);
  const [invitations, setInvitations] = useState<ChatGroupInvitation[]>([]);
  const [approvalRequests, setApprovalRequests] = useState<Array<ChatGroupJoinRequest & { group: Pick<ChatGroupSummary, "id" | "conversationId" | "name" | "avatarUrl"> }>>([]);
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
  const [groupName, setGroupName] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [alias, setAlias] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  const refreshLists = useCallback(async () => {
    const [groupResult, approvalResult] = await Promise.all([
      listChatGroups(accessToken),
      listChatGroupApprovals(accessToken),
    ]);
    setGroups(groupResult.items);
    setInvitations(approvalResult.invitations);
    setApprovalRequests(approvalResult.joinRequests);
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
        if (active && initialGroupId && initialView !== "invites") await openGroup(initialGroupId);
      })
      .catch((loadError) => { if (active) setError(messageOf(loadError, "群聊列表读取失败。")); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [initialGroupId, initialView, openGroup, refreshLists]);

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
        membersCanInvite: selectedGroup.membersCanInvite,
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
    <section aria-modal="true" className="chat-group-manager" onClick={(event) => event.stopPropagation()} onTouchMove={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} role="dialog">
      <header>
        <span><Users aria-hidden="true" size={19} /><strong>群聊</strong></span>
        <button aria-label="关闭群聊管理" onClick={onClose} type="button"><X aria-hidden="true" size={18} /></button>
      </header>
      <div className="chat-group-manager-body">
        <nav aria-label="群聊功能">
          <button className={view === "mine" || view === "detail" ? "active" : ""} onClick={() => setView("mine")} type="button"><MessageCircle aria-hidden="true" size={16} />我的群聊</button>
          <button className={view === "invites" ? "active" : ""} onClick={() => setView("invites")} type="button"><UserPlus aria-hidden="true" size={16} />群审批{invitations.length + approvalRequests.length ? <b>{invitations.length + approvalRequests.length}</b> : null}</button>
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
              <div className="chat-group-inline-actions"><button aria-label="接受群邀请" disabled={Boolean(busyKey)} onClick={() => void run(`invite:${invitation.id}`, async () => {
                const result = await respondChatGroupInvitation(accessToken, invitation.id, "accepted");
                if (result.group) await openGroup(result.group.id);
              }, "已加入群聊。")} title="接受" type="button"><Check aria-hidden="true" size={13} />接受</button><button aria-label="拒绝群邀请" disabled={Boolean(busyKey)} onClick={() => void run(`invite:${invitation.id}`, async () => { await respondChatGroupInvitation(accessToken, invitation.id, "declined"); }, "已拒绝群邀请。")} title="拒绝" type="button"><X aria-hidden="true" size={13} />拒绝</button></div>
            </article>)}
            {approvalRequests.map((request) => <article className="chat-group-invitation" key={`request-${request.id}`}>
              <GroupAvatar group={request.group} />
              <span><strong>{request.group.name}</strong><small>{request.user.nickname} 申请加入 · {request.note || "未填写申请说明"}</small></span>
              <div className="chat-group-inline-actions"><button aria-label="同意入群申请" disabled={Boolean(busyKey)} onClick={() => void run(`approval:${request.id}`, async () => {
                await respondChatGroupJoinRequest(accessToken, request.groupId, request.id, "approved");
              }, "已同意入群申请。")} title="同意" type="button"><Check aria-hidden="true" size={13} />同意</button><button aria-label="拒绝入群申请" disabled={Boolean(busyKey)} onClick={() => void run(`approval:${request.id}`, async () => {
                await respondChatGroupJoinRequest(accessToken, request.groupId, request.id, "rejected");
              }, "已拒绝入群申请。")} title="拒绝" type="button"><X aria-hidden="true" size={13} />拒绝</button></div>
            </article>)}
            {!invitations.length && !approvalRequests.length ? <div className="chat-group-state">当前没有待处理的群邀请或入群申请。</div> : null}
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
            <div className="chat-group-detail-identity"><GroupAvatar group={selectedGroup} large /><span><strong>{selectedGroup.name}</strong><small>{selectedGroup.memberCount}/{selectedGroup.memberLimit} 人 · {groupRoleLabel(selectedGroup.currentMemberRole)}{selectedGroup.temporary && selectedGroup.expiresAt ? ` · ${formatExpiry(selectedGroup.expiresAt)}` : ""}</small></span><div className="chat-group-detail-actions">{selectedGroup.currentMemberRole === "owner" ? <button aria-label="解散群聊" className="danger" disabled={Boolean(busyKey)} onClick={() => void run("dissolve", async () => { await dissolveChatGroup(accessToken, selectedGroup.id); setSelectedGroup(null); setView("mine"); }, "群聊已解散。")} title="解散群聊" type="button"><Trash2 aria-hidden="true" size={16} /></button> : <button aria-label="退出群聊" className="danger" disabled={Boolean(busyKey)} onClick={() => void run("leave", async () => { await leaveChatGroup(accessToken, selectedGroup.id); setSelectedGroup(null); setView("mine"); }, "已退出群聊。")} title="退出群聊" type="button"><DoorOpen aria-hidden="true" size={16} /></button>}<button aria-label="进入群聊" onClick={() => onOpenConversation(selectedGroup.conversationId)} title="进入群聊" type="button"><MessageCircle aria-hidden="true" size={16} /></button></div></div>
            {selectedGroup.isBanned ? <div className="chat-group-ban-status"><Ban aria-hidden="true" size={16} /><span><strong>该群已被站点封禁</strong><small>{selectedGroup.bannedUntil ? `${formatMinute(selectedGroup.bannedUntil)} 自动解除` : "永久封禁"}{selectedGroup.banReason ? ` · ${selectedGroup.banReason}` : ""}</small></span></div> : null}
            {selectedGroup.announcement ? <p className="chat-group-announcement">{selectedGroup.announcement}</p> : null}
            <div className="chat-group-detail-grid">
              <section>
                <h3><span>我的群名片</span><button aria-label="保存群名片" className="chat-group-heading-action" disabled={busyKey === "alias"} onClick={() => void saveAlias()} title="保存群名片" type="button"><Save aria-hidden="true" size={15} /></button></h3>
                <label><span>群内昵称</span><input maxLength={32} onChange={(event) => setAlias(event.target.value)} placeholder="跟随账号昵称" value={alias} /></label>
              </section>
              {selectedGroup.canManage ? <section>
                <h3><span>群资料</span><button aria-label="保存群资料" className="chat-group-heading-action" disabled={busyKey === "save" || busyKey === "avatar"} onClick={() => void saveGroup()} title="保存群资料" type="button"><Save aria-hidden="true" size={15} /></button></h3>
                <label><span>名称</span><input maxLength={60} onChange={(event) => setGroupName(event.target.value)} value={groupName} /></label>
                <label><span>公告</span><textarea maxLength={1000} onChange={(event) => setAnnouncement(event.target.value)} rows={3} value={announcement} /></label>
                <label className="chat-group-switch"><input checked={selectedGroup.membersCanInvite} onChange={(event) => setSelectedGroup({ ...selectedGroup, membersCanInvite: event.target.checked, canInvite: true })} type="checkbox" /><span>允许普通成员邀请入群</span></label>
                <label><span>头像地址</span><div><input onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://" value={avatarUrl} /><button aria-label="上传群头像" onClick={() => avatarInputRef.current?.click()} title="上传群头像" type="button"><ImagePlus aria-hidden="true" size={16} /></button></div></label>
                <input accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => void uploadAvatar(event.target.files?.[0])} ref={avatarInputRef} type="file" />
              </section> : null}
            </div>
            {selectedGroup.canInvite ? <section className="chat-group-management-section"><h3><span>邀请成员</span><button aria-label={`发送 ${inviteSelection.size} 个群邀请`} className="chat-group-heading-action" disabled={!inviteSelection.size || busyKey === "invite"} onClick={() => void inviteSelected()} title={inviteSelection.size ? `发送邀请（${inviteSelection.size}）` : "请选择成员"} type="button"><UserPlus aria-hidden="true" size={15} /></button></h3><GroupInviteSelector candidates={searchableInvitees} isSearching={isInviteSearchBusy} query={inviteSearchText} selected={inviteSelection} setQuery={setInviteSearchText} setSelected={setInviteSelection} onSearch={() => void searchInviteesNow()} /></section> : null}
            {selectedGroup.canManage && joinRequests.length ? <section className="chat-group-management-section"><h3>入群申请 <b>{joinRequests.length}</b></h3><div className="chat-group-request-list">{joinRequests.map((request) => <article key={request.id}><UserAvatar user={request.user} /><span><strong>{request.user.nickname}</strong><small>{request.note || "未填写申请说明"}</small></span><button aria-label={`同意 ${request.user.nickname} 入群`} onClick={() => void run(`request:${request.id}`, async () => { await respondChatGroupJoinRequest(accessToken, selectedGroup.id, request.id, "approved"); await refreshCurrentGroup(); }, "已同意入群申请。")} title="同意" type="button"><Check aria-hidden="true" size={14} /></button><button aria-label={`拒绝 ${request.user.nickname} 入群`} onClick={() => void run(`request:${request.id}`, async () => { await respondChatGroupJoinRequest(accessToken, selectedGroup.id, request.id, "rejected"); await refreshCurrentGroup(); }, "已拒绝入群申请。")} title="拒绝" type="button"><X aria-hidden="true" size={14} /></button></article>)}</div></section> : null}
            <section className="chat-group-management-section"><h3>群成员 <b>{activeMembers.length}</b></h3><div className="chat-group-member-avatar-grid">{activeMembers.map((member) => <GroupMemberAvatar accessToken={accessToken} group={selectedGroup} key={member.user.id} member={member} onOpenProfile={openMemberProfile} onUpdated={setSelectedGroup} run={run} />)}</div></section>
            {selectedGroup.canManage && blockedMembers.length ? <section className="chat-group-management-section"><h3>群黑名单 <b>{blockedMembers.length}</b></h3><div className="chat-group-member-avatar-grid">{blockedMembers.map((member) => <GroupMemberAvatar accessToken={accessToken} blocked group={selectedGroup} key={member.user.id} member={member} onOpenProfile={openMemberProfile} onUpdated={setSelectedGroup} run={run} />)}</div></section> : null}
            {selectedGroup.canManage ? <GroupReports accessToken={accessToken} groupId={selectedGroup.id} run={run} /> : null}
            {selectedGroup.banRecords.length ? <section className="chat-group-management-section chat-group-ban-records"><h3>封禁记录 <b>{selectedGroup.banRecords.length}</b></h3>{selectedGroup.banRecords.map((record) => <article key={record.id}><Ban aria-hidden="true" size={14} /><span><strong>{record.reason}</strong><small>{record.actor.nickname} 于 {formatMinute(record.startsAt)} {record.expiresAt ? `封禁至 ${formatMinute(record.expiresAt)}` : "永久封禁"}{record.liftedAt ? ` · 已于 ${formatMinute(record.liftedAt)} 解除` : ""}</small></span></article>)}</section> : null}
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
  return <section className="chat-group-management-section"><h3>待处理举报 <b>{reports.length}</b></h3><div className="chat-group-report-list">{reports.map((report) => <article key={report.id}><GroupAvatar group={report.group} /><span><strong>{report.reporter.nickname} 举报了 {report.message.sender.nickname}</strong><small>{report.group.name}</small><GroupReportMessage accessToken={accessToken} attachments={report.message.attachments} body={report.message.body} /><small>{report.detail || report.reason}</small></span><div className="chat-group-report-actions"><button aria-label="处理举报并删除消息" onClick={() => void run(`report:${report.id}`, async () => { await handleChatGroupReport(accessToken, report.id, { status: "resolved", deleteMessage: true, resolution: "群管理员已删除消息" }); setReports((current) => current.filter((item) => item.id !== report.id)); }, "举报已处理，消息已删除。")} title="处理" type="button"><Check aria-hidden="true" size={13} /></button><button aria-label="驳回举报" onClick={() => void run(`report:${report.id}`, async () => { await handleChatGroupReport(accessToken, report.id, { status: "rejected", resolution: "未发现违规" }); setReports((current) => current.filter((item) => item.id !== report.id)); }, "举报已驳回。")} title="驳回" type="button"><X aria-hidden="true" size={13} /></button></div></article>)}</div></section>;
}

function GroupReportMessage({ accessToken, attachments, body }: { accessToken: string; attachments: ChatAttachment[]; body: string }) {
  const images = attachments.filter((attachment) => attachment.kind === "image");
  const files = attachments.filter((attachment) => attachment.kind !== "image");
  return <div className="chat-group-report-content">
    {body ? <q>{body}</q> : null}
    {images.length ? <div className={`chat-message-attachments chat-message-images count-${images.length} chat-group-report-images`}>{images.map((attachment) => <GroupReportImage accessToken={accessToken} attachment={attachment} key={attachment.id} />)}</div> : null}
    {files.map((attachment) => <button className="chat-group-report-file" key={attachment.id} onClick={() => void downloadChatAttachment(accessToken, attachment).then((blob) => saveBlob(blob, attachment.originalName))} type="button"><Download aria-hidden="true" size={14} /><span><strong>{attachment.originalName}</strong><small>{formatBytes(attachment.sizeBytes)}</small></span></button>)}
  </div>;
}

function GroupReportImage({ accessToken, attachment }: { accessToken: string; attachment: ChatAttachment }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    downloadChatAttachmentThumbnail(accessToken, attachment).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [accessToken, attachment]);
  return <button className="chat-image-attachment chat-group-report-image" onClick={() => void downloadChatAttachment(accessToken, attachment).then((blob) => openBlob(blob))} type="button">{url ? <img alt={attachment.originalName} src={url} /> : <ImagePlus aria-hidden="true" size={18} />}</button>;
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
  return <section className="chat-group-friend-selector"><form className="chat-group-invite-search" onSubmit={(event) => { event.preventDefault(); onSearch(); }}><Search aria-hidden="true" size={15} /><input maxLength={32} onChange={(event) => setQuery(event.target.value)} placeholder="搜索昵称或用户名" value={query} /><button aria-label="搜索可邀请用户" disabled={isSearching} title="搜索" type="submit">{isSearching ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : <Search aria-hidden="true" size={14} />}</button></form><div>{candidates.map((candidate) => <button aria-pressed={selected.has(candidate.id)} key={candidate.id} onClick={() => { const next = new Set(selected); if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id); setSelected(next); }} type="button"><UserAvatar user={candidate} /><span><strong>{candidate.nickname}</strong><small>@{candidate.username}</small></span><i>{selected.has(candidate.id) ? <Check aria-hidden="true" size={12} /> : null}</i></button>)}</div>{!candidates.length ? <small>{query.trim() ? "没有找到可邀请用户。" : "暂无可邀请好友，可搜索昵称或用户名邀请其他用户。"}</small> : null}</section>;
}

function GroupMemberAvatar({
  accessToken,
  blocked = false,
  group,
  member,
  onOpenProfile,
  onUpdated,
  run,
}: {
  accessToken: string;
  blocked?: boolean;
  group: ChatGroup;
  member: ChatGroupMember;
  onOpenProfile: (username: string) => void;
  onUpdated: (group: ChatGroup) => void;
  run: (key: string, action: () => Promise<void>, success: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const [menuAnchor, setMenuAnchor] = useState({ left: 0, top: 0 });
  const longPressRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const muted = Boolean(member.mutedUntil && new Date(member.mutedUntil) > new Date());
  const canOperate = !blocked && group.canManage && !member.isSelf && member.role !== "owner" && (
    group.currentMemberRole === "owner" || member.role === "member"
  );

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const left = menuAnchor.left + 10 + rect.width <= window.innerWidth - 8
      ? menuAnchor.left + 10
      : menuAnchor.left - rect.width - 10;
    const top = menuAnchor.top + 8 + rect.height <= window.innerHeight - 8
      ? menuAnchor.top + 8
      : menuAnchor.top - rect.height - 8;
    setMenuPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - rect.height - 8)),
    });
  }, [menuAnchor, open]);

  useEffect(() => () => {
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
  }, []);

  function openMenu(clientX: number, clientY: number) {
    setMenuAnchor({ left: clientX, top: clientY });
    setMenuPosition({ left: clientX + 10, top: clientY + 8 });
    setOpen(true);
  }

  function update(input: { role?: "admin" | "member"; mutedMinutes?: number }, success: string) {
    void run(`member:${member.user.id}`, async () => {
      onUpdated(await updateChatGroupMember(accessToken, group.id, member.user.id, input));
      setOpen(false);
    }, success);
  }

  return <span className="chat-group-member-avatar-wrap" onPointerLeave={() => {
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
  }}>
    <button
      aria-label={`${member.alias || member.user.nickname}，${blocked ? "已拉黑" : groupRoleLabel(member.role)}`}
      className="chat-group-member-avatar-button"
      onContextMenu={(event) => { event.preventDefault(); openMenu(event.clientX, event.clientY); }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") return;
        longPressTriggeredRef.current = false;
        const { clientX, clientY } = event;
        longPressRef.current = window.setTimeout(() => {
          longPressRef.current = null;
          longPressTriggeredRef.current = true;
          openMenu(clientX, clientY);
        }, 520);
      }}
      onPointerUp={() => {
        if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }}
      onPointerCancel={() => {
        if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }}
      onClick={(event) => {
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false;
          event.preventDefault();
          return;
        }
        if (!open) onOpenProfile(member.user.username);
      }}
      title={`${member.alias || member.user.nickname} · ${blocked ? "已拉黑" : `${groupRoleLabel(member.role)}${muted ? " · 已禁言" : ""}`}`}
      type="button"
    >
      <UserAvatar user={member.user} />
      {!blocked ? <i className={member.role}>{member.role === "owner" ? <Crown aria-hidden="true" size={12} /> : member.role === "admin" ? <ShieldCheck aria-hidden="true" size={12} /> : <Shield aria-hidden="true" size={11} />}</i> : null}
    </button>
    {open && typeof document !== "undefined" ? createPortal(<div className="chat-group-member-context" onPointerDown={(event) => event.stopPropagation()} onTouchMove={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} ref={menuRef} style={menuPosition}>
      {!blocked ? <><strong>{member.alias || member.user.nickname}</strong><button onClick={() => onOpenProfile(member.user.username)} type="button">查看主页</button></> : null}
      {blocked ? <button onClick={() => void run(`unblock:${member.user.id}`, async () => { onUpdated(await unblockChatGroupMember(accessToken, group.id, member.user.id)); setOpen(false); }, "已解除群聊拉黑。")} type="button">解除拉黑</button> : null}
      {canOperate ? <>
        {group.currentMemberRole === "owner" ? <button onClick={() => update({ role: member.role === "admin" ? "member" : "admin" }, member.role === "admin" ? "已取消管理员。" : "已设为管理员。")} type="button">{member.role === "admin" ? "取消管理员" : "设为管理员"}</button> : null}
        <span>禁言时长</span>
        <div className="chat-group-mute-options">
          {muted ? <button onClick={() => update({ mutedMinutes: 0 }, "已解除禁言。")} type="button"><Bell aria-hidden="true" size={13} />解除</button> : [10, 60, 1440, 10080, 43200].map((minutes) => <button key={minutes} onClick={() => update({ mutedMinutes: minutes }, `已禁言 ${muteDurationLabel(minutes)}。`)} type="button"><BellOff aria-hidden="true" size={13} />{muteDurationLabel(minutes)}</button>)}
        </div>
        {group.currentMemberRole === "owner" ? <button onClick={() => void run(`transfer:${member.user.id}`, async () => { onUpdated(await transferChatGroupOwner(accessToken, group.id, member.user.id)); setOpen(false); }, "群主已转让。")} type="button">转让群主</button> : null}
        <button onClick={() => void run(`remove:${member.user.id}`, async () => { onUpdated(await removeChatGroupMember(accessToken, group.id, member.user.id)); setOpen(false); }, "成员已移出群聊。")} type="button">移出群聊</button>
        <button className="danger" onClick={() => void run(`block:${member.user.id}`, async () => { onUpdated(await blockChatGroupMember(accessToken, group.id, member.user.id)); setOpen(false); }, "成员已拉黑。")} type="button">拉黑成员</button>
      </> : null}
    </div>, document.body) : null}
  </span>;
}

function GroupAvatar({ group, large = false }: { group: Pick<ChatGroupSummary, "name" | "avatarUrl">; large?: boolean }) {
  return <span className={`chat-group-avatar${large ? " large" : ""}`}>{group.avatarUrl ? <img alt="" draggable={false} src={resolveApiUrl(group.avatarUrl)} /> : fallbackText(group.name)}</span>;
}

function UserAvatar({ user }: { user: { nickname: string; avatarUrl: string | null } }) {
  return <span className="chat-user-avatar">{user.avatarUrl ? <img alt="" draggable={false} src={resolveApiUrl(user.avatarUrl)} /> : fallbackText(user.nickname)}</span>;
}

function muteDurationLabel(minutes: number): string {
  if (minutes === 10) return "10 分钟";
  if (minutes === 60) return "1 小时";
  if (minutes === 1440) return "1 天";
  if (minutes === 10080) return "7 天";
  return "30 天";
}

function groupRoleLabel(role: ChatGroupSummary["currentMemberRole"] | "owner" | "admin" | "member"): string {
  if (role === "owner") return "群主";
  if (role === "admin") return "管理员";
  return "成员";
}

function formatExpiry(value: string): string {
  return `${new Date(value).toLocaleString("zh-CN", { hour12: false })} 到期`;
}

function formatMinute(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function fallbackText(name: string): string {
  return Array.from(name.trim()).slice(-2).join("").toUpperCase();
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
