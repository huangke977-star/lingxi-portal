"use client";

import Link from "next/link";
import { RefreshCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  CacheKeyCategory,
  CacheKeyDetail,
  CacheKeyPage,
  CacheKeySummary,
  CacheKeyType,
  CacheOverview,
  deleteCacheKeys,
  getCacheOverview,
  inspectCacheKey,
  listCacheKeys,
  updateCacheKeyTtl,
  updateCacheKeysTtl,
} from "@/lib/cache-admin-api";

const KEY_TYPE_LABEL: Record<CacheKeyType, string> = {
  string: "String",
  list: "List",
  set: "Set",
  zset: "ZSet",
  hash: "Hash",
  stream: "Stream",
  none: "None",
};

const CATEGORY_LABEL: Record<CacheKeyCategory, string> = {
  "refresh-session": "登录会话",
  "user-sessions": "用户会话索引",
  "login-failure": "登录失败计数",
  "business-cache": "业务缓存",
};

export default function CacheManagementPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [overview, setOverview] = useState<CacheOverview | null>(null);
  const [keyPage, setKeyPage] = useState<CacheKeyPage | null>(null);
  const [cursor, setCursor] = useState("0");
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [batchSize, setBatchSize] = useState(10);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [detail, setDetail] = useState<CacheKeyDetail | null>(null);
  const [ttlDraft, setTtlDraft] = useState("3600");
  const [bulkTtlDraft, setBulkTtlDraft] = useState("3600");
  const [isBulkTtlOpen, setIsBulkTtlOpen] = useState(false);
  const [isBulkTtlUpdating, setIsBulkTtlUpdating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isOverviewRefreshing, setIsOverviewRefreshing] = useState(false);
  const [isKeysLoading, setIsKeysLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let isMounted = true;
    const token = readAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    async function loadAccess(verifiedToken: string) {
      setError("");
      try {
        const me = await getMe(verifiedToken);
        if (!isMounted) {
          return;
        }
        setAccessToken(verifiedToken);
        setCurrentUser(me);
        if (!me.isSuperAdmin) {
          return;
        }

        const nextOverview = await getCacheOverview(verifiedToken);
        if (isMounted) {
          setOverview(nextOverview);
        }
      } catch (loadError) {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "无法读取 Redis 状态。",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadAccess(token);
    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setCursor("0");
      setCursorHistory([]);
      setSearchQuery(searchDraft.trim());
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [searchDraft]);

  useEffect(() => {
    if (!accessToken || !currentUser?.isSuperAdmin) {
      return;
    }

    const token = accessToken;
    let isMounted = true;
    async function loadKeys() {
      setIsKeysLoading(true);
      setError("");
      try {
        const nextPage = await listCacheKeys(token, {
          cursor,
          count: batchSize,
          search: searchQuery,
          type: typeFilter,
          category: categoryFilter,
        });
        if (isMounted) {
          setKeyPage(nextPage);
          setSelectedKeys([]);
        }
      } catch (loadError) {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        if (isMounted) {
          setError(
            loadError instanceof Error ? loadError.message : "无法读取缓存键。",
          );
        }
      } finally {
        if (isMounted) {
          setIsKeysLoading(false);
        }
      }
    }

    void loadKeys();
    return () => {
      isMounted = false;
    };
  }, [
    accessToken,
    batchSize,
    categoryFilter,
    currentUser,
    cursor,
    reloadVersion,
    router,
    searchQuery,
    typeFilter,
  ]);

  useEffect(() => {
    if (!accessToken || !currentUser?.isSuperAdmin) {
      return;
    }

    const token = accessToken;
    const intervalId = window.setInterval(() => {
      void getCacheOverview(token)
        .then(setOverview)
        .catch((pollError: unknown) => {
          if (isAuthExpiredError(pollError)) {
            clearAuthTokens();
            router.replace("/");
          }
        });
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [accessToken, currentUser, router]);

  const allCurrentKeysSelected = useMemo(() => {
    const keys = keyPage?.keys ?? [];
    return (
      keys.length > 0 && keys.every((item) => selectedKeys.includes(item.key))
    );
  }, [keyPage, selectedKeys]);

  const selectedSummaries = useMemo(
    () =>
      (keyPage?.keys ?? []).filter((item) =>
        selectedKeys.includes(item.key),
      ),
    [keyPage, selectedKeys],
  );

  const ttlEditableSelectedKeys = useMemo(
    () =>
      selectedSummaries
        .filter((item) => item.canUpdateTtl)
        .map((item) => item.key),
    [selectedSummaries],
  );

  async function refreshOverview() {
    if (!accessToken) {
      return;
    }
    setIsOverviewRefreshing(true);
    setError("");
    try {
      setOverview(await getCacheOverview(accessToken));
      setReloadVersion((version) => version + 1);
    } catch (refreshError) {
      if (isAuthExpiredError(refreshError)) {
        clearAuthTokens();
        router.replace("/");
        return;
      }
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "刷新 Redis 状态失败。",
      );
    } finally {
      setIsOverviewRefreshing(false);
    }
  }

  async function openDetail(key: string) {
    if (!accessToken) {
      return;
    }
    setBusyKey(key);
    setError("");
    try {
      const nextDetail = await inspectCacheKey(accessToken, key);
      setDetail(nextDetail);
      setTtlDraft(
        nextDetail.ttlSeconds > 0 ? String(nextDetail.ttlSeconds) : "3600",
      );
    } catch (detailError) {
      if (isAuthExpiredError(detailError)) {
        clearAuthTokens();
        router.replace("/");
        return;
      }
      setError(
        detailError instanceof Error ? detailError.message : "读取键值失败。",
      );
    } finally {
      setBusyKey(null);
    }
  }

  function closeDetail() {
    if (!isDeleting) {
      setDetail(null);
    }
  }

  function toggleKey(key: string) {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  function toggleCurrentPage() {
    const keys = keyPage?.keys.map((item) => item.key) ?? [];
    setSelectedKeys(allCurrentKeysSelected ? [] : keys);
  }

  async function handleDelete(keys: string[]) {
    if (!accessToken || keys.length === 0) {
      return;
    }
    const confirmed = window.confirm(
      buildDeleteConfirmation(keys, keyPage?.keys ?? [], detail),
    );
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setError("");
    setNotice("");
    try {
      const result = await deleteCacheKeys(accessToken, keys);
      setDetail(null);
      setSelectedKeys([]);
      setReloadVersion((version) => version + 1);
      setOverview(await getCacheOverview(accessToken));
      setNotice(formatDeleteResult(result));
    } catch (deleteError) {
      if (isAuthExpiredError(deleteError)) {
        clearAuthTokens();
        router.replace("/");
        return;
      }
      setError(
        deleteError instanceof Error ? deleteError.message : "缓存键操作失败。",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleTtlSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !detail?.canUpdateTtl) {
      return;
    }
    const ttlSeconds = Number(ttlDraft);
    if (
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds < 60 ||
      ttlSeconds > 31_536_000
    ) {
      setError("TTL 必须是 60 到 31536000 之间的整数秒。");
      return;
    }

    setBusyKey(detail.key);
    setError("");
    setNotice("");
    try {
      const updated = await updateCacheKeyTtl(
        accessToken,
        detail.key,
        ttlSeconds,
      );
      setDetail((current) =>
        current ? { ...current, ttlSeconds: updated.ttlSeconds } : current,
      );
      setKeyPage((current) =>
        current
          ? {
              ...current,
              keys: current.keys.map((item) =>
                item.key === updated.key ? updated : item,
              ),
            }
          : current,
      );
      setNotice("缓存键 TTL 已更新。");
    } catch (ttlError) {
      if (isAuthExpiredError(ttlError)) {
        clearAuthTokens();
        router.replace("/");
        return;
      }
      setError(ttlError instanceof Error ? ttlError.message : "TTL 更新失败。");
    } finally {
      setBusyKey(null);
    }
  }

  function openBulkTtl() {
    if (ttlEditableSelectedKeys.length === 0) {
      return;
    }
    const firstEditable = selectedSummaries.find((item) => item.canUpdateTtl);
    setBulkTtlDraft(
      firstEditable && firstEditable.ttlSeconds > 0
        ? String(firstEditable.ttlSeconds)
        : "3600",
    );
    setIsBulkTtlOpen(true);
  }

  async function handleBulkTtlSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || ttlEditableSelectedKeys.length === 0) {
      return;
    }
    const ttlSeconds = Number(bulkTtlDraft);
    if (
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds < 60 ||
      ttlSeconds > 31_536_000
    ) {
      setError("TTL 必须是 60 到 31536000 之间的整数秒。");
      return;
    }

    setIsBulkTtlUpdating(true);
    setError("");
    setNotice("");
    try {
      const updated = await updateCacheKeysTtl(
        accessToken,
        ttlEditableSelectedKeys,
        ttlSeconds,
      );
      const updatedByKey = new Map(updated.map((item) => [item.key, item]));
      setKeyPage((current) =>
        current
          ? {
              ...current,
              keys: current.keys.map(
                (item) => updatedByKey.get(item.key) ?? item,
              ),
            }
          : current,
      );
      setDetail((current) =>
        current && updatedByKey.has(current.key)
          ? {
              ...current,
              ttlSeconds: updatedByKey.get(current.key)?.ttlSeconds ??
                current.ttlSeconds,
            }
          : current,
      );
      setIsBulkTtlOpen(false);
      setNotice(`已更新 ${updated.length} 个缓存键的 TTL。`);
    } catch (ttlError) {
      if (isAuthExpiredError(ttlError)) {
        clearAuthTokens();
        router.replace("/");
        return;
      }
      setError(
        ttlError instanceof Error ? ttlError.message : "批量修改 TTL 失败。",
      );
    } finally {
      setIsBulkTtlUpdating(false);
    }
  }

  async function copyDetailValue() {
    if (!detail) {
      return;
    }
    const value = formatDetailValue(detail.value);
    await navigator.clipboard.writeText(value);
    setNotice("已复制当前显示的脱敏内容。");
  }

  function goNext() {
    if (!keyPage || keyPage.done) {
      return;
    }
    setCursorHistory((history) => [...history, cursor]);
    setCursor(keyPage.nextCursor);
  }

  function goPrevious() {
    setCursorHistory((history) => {
      const previous = history.at(-1);
      if (previous !== undefined) {
        setCursor(previous);
      }
      return history.slice(0, -1);
    });
  }

  if (isLoading) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>缓存管理</h1>
        <div className="status-row">
          <span className="status">正在连接 Redis</span>
        </div>
      </section>
    );
  }

  if (!currentUser) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>无法进入缓存管理</h1>
        <p>{error || "请重新登录后再访问。"}</p>
        <Link className="text-action primary" href="/login">
          返回登录
        </Link>
      </section>
    );
  }

  if (!currentUser.isSuperAdmin) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>无权访问</h1>
        <p>缓存数据仅超级管理员可查看和操作。</p>
        <Link className="text-action primary" href="/dashboard">
          返回工作台
        </Link>
      </section>
    );
  }

  return (
    <section className="page-shell admin-shell cache-admin-shell">
      <AppToast
        duration={error ? 4200 : 2600}
        message={error || notice}
        onDismiss={() => {
          setError("");
          setNotice("");
        }}
        tone={error ? "error" : "success"}
      />

      <div className="cache-overview-toolbar">
        <span>Redis</span>
        <button aria-label="刷新缓存数据" disabled={isOverviewRefreshing} onClick={() => void refreshOverview()} title="刷新缓存数据" type="button">
          <RefreshCcw aria-hidden="true" className={isOverviewRefreshing ? "spinning" : undefined} size={17} />
        </button>
      </div>

      {overview ? <CacheOverviewGrid overview={overview} /> : null}

      <div className="cache-table-heading">
        <div>
          <span className="section-label">Cache keys</span>
          <h2>缓存键</h2>
        </div>
      </div>

      <div className="cache-toolbar">
        <label className="cache-search-field">
          <span>搜索键名</span>
          <input
            maxLength={128}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="输入完整键名或部分内容"
            type="search"
            value={searchDraft}
          />
        </label>
        <label>
          <span>缓存分类</span>
          <select
            onChange={(event) => {
              setCursor("0");
              setCursorHistory([]);
              setCategoryFilter(event.target.value);
            }}
            value={categoryFilter}
          >
            <option value="">全部分类</option>
            {Object.entries(CATEGORY_LABEL).map(([category, label]) => (
              <option key={category} value={category}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>数据类型</span>
          <select
            onChange={(event) => {
              setCursor("0");
              setCursorHistory([]);
              setTypeFilter(event.target.value);
            }}
            value={typeFilter}
          >
            <option value="">全部类型</option>
            {Object.entries(KEY_TYPE_LABEL)
              .filter(([type]) => type !== "none")
              .map(([type, label]) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>每页数量</span>
          <select
            onChange={(event) => {
              setCursor("0");
              setCursorHistory([]);
              setBatchSize(Number(event.target.value));
            }}
            value={batchSize}
          >
            <option value={10}>10 条</option>
            <option value={20}>20 条</option>
            <option value={50}>50 条</option>
            <option value={100}>100 条</option>
          </select>
        </label>
      </div>

      {selectedKeys.length ? (
        <div className="cache-selection-bar">
          <span className="cache-selection-summary">
            <span>
              已选择 <strong>{selectedKeys.length}</strong> 项，其中{" "}
              <strong>{ttlEditableSelectedKeys.length}</strong> 项可修改 TTL
            </span>
            {ttlEditableSelectedKeys.length === 0 ? (
              <small>当前选择的是认证缓存，TTL 由登录策略统一管理。</small>
            ) : null}
          </span>
          <div className="cache-selection-actions">
            <button
              className="text-action"
              disabled={ttlEditableSelectedKeys.length === 0}
              onClick={openBulkTtl}
              title={
                ttlEditableSelectedKeys.length
                  ? "批量修改已选业务缓存的 TTL"
                  : "登录相关缓存不允许修改 TTL"
              }
              type="button"
            >
              修改 TTL（{ttlEditableSelectedKeys.length} 项）
            </button>
           <button
             className="cache-danger-action"
             disabled={isDeleting}
             onClick={() => void handleDelete(selectedKeys)}
             type="button"
           >
              删除/清理选中项
           </button>
          </div>
        </div>
      ) : null}

      <div className="admin-table-wrap cache-table-wrap">
        <table className="admin-table cache-table">
          <thead>
            <tr>
              <th className="cache-select-cell">
                <input
                  aria-label="选择当前批次全部缓存键"
                  checked={allCurrentKeysSelected}
                  onChange={toggleCurrentPage}
                  type="checkbox"
                />
              </th>
              <th>键名</th>
              <th>分类</th>
              <th>类型</th>
              <th>TTL</th>
              <th>内存</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {isKeysLoading ? (
              <tr>
                <td className="admin-table-state" colSpan={7}>
                  正在扫描缓存键
                </td>
              </tr>
            ) : keyPage?.keys.length ? (
              keyPage.keys.map((item) => (
                <tr key={item.key}>
                  <td className="cache-select-cell">
                    <input
                      aria-label={`选择缓存键 ${item.key}`}
                      checked={selectedKeys.includes(item.key)}
                      onChange={() => toggleKey(item.key)}
                      type="checkbox"
                    />
                  </td>
                  <td>
                    <button
                      className="cache-key-link"
                      onClick={() => void openDetail(item.key)}
                      type="button"
                    >
                      {item.key}
                    </button>
                  </td>
                  <td>{CATEGORY_LABEL[item.category]}</td>
                  <td>
                    <span className={`cache-type-badge ${item.type}`}>
                      {KEY_TYPE_LABEL[item.type]}
                    </span>
                  </td>
                  <td>
                    <span className="cache-ttl-display">
                      <span>{formatTtl(item.ttlSeconds)}</span>
                      {!item.canUpdateTtl ? (
                        <small title="认证缓存 TTL 由登录策略统一管理">
                          系统管理
                        </small>
                      ) : null}
                    </span>
                  </td>
                  <td>{formatBytes(item.memoryBytes)}</td>
                  <td>
                    <button
                      className="table-action"
                      disabled={busyKey === item.key}
                      onClick={() => void openDetail(item.key)}
                      type="button"
                    >
                      {busyKey === item.key ? "读取中" : "查看"}
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="admin-table-state" colSpan={7}>
                  没有找到匹配的缓存键
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <nav aria-label="缓存键游标分页" className="admin-pagination">
        <span>{keyPage?.done ? "已到当前扫描末尾" : "Redis 游标分批加载"}</span>
        <div>
          <button
            disabled={isKeysLoading || cursorHistory.length === 0}
            onClick={goPrevious}
            type="button"
          >
            上一批
          </button>
          <button
            disabled={isKeysLoading || !keyPage || keyPage.done}
            onClick={goNext}
            type="button"
          >
            下一批
          </button>
        </div>
      </nav>

      {isBulkTtlOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !isBulkTtlUpdating
            ) {
              setIsBulkTtlOpen(false);
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="bulk-ttl-title"
            aria-modal="true"
            className="modal-panel cache-bulk-ttl-panel"
            role="dialog"
          >
            <div className="modal-heading">
              <span className="section-label">Batch TTL</span>
              <h2 id="bulk-ttl-title">批量修改 TTL</h2>
              <p>
                将同时修改 {ttlEditableSelectedKeys.length}
                个已选业务缓存，登录相关缓存不会包含在内。
              </p>
            </div>
            <form
              className="form-stack modal-form"
              onSubmit={(event) => void handleBulkTtlSubmit(event)}
            >
              <label>
                <span>TTL（秒）</span>
                <input
                  inputMode="numeric"
                  max={31_536_000}
                  min={60}
                  onChange={(event) => setBulkTtlDraft(event.target.value)}
                  required
                  type="number"
                  value={bulkTtlDraft}
                />
              </label>
              <div className="actions">
                <button
                  className="button"
                  disabled={isBulkTtlUpdating}
                  type="submit"
                >
                  {isBulkTtlUpdating ? "保存中" : "保存 TTL"}
                </button>
                <button
                  className="button secondary"
                  disabled={isBulkTtlUpdating}
                  onClick={() => setIsBulkTtlOpen(false)}
                  type="button"
                >
                  取消
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {detail ? (
        <div
          className="modal-backdrop cache-detail-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDetail();
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="cache-detail-title"
            aria-modal="true"
            className="cache-detail-panel"
            role="dialog"
          >
            <div className="cache-detail-heading">
              <div>
                <span className="section-label">
                  {CATEGORY_LABEL[detail.category]}
                </span>
                <h2 id="cache-detail-title">缓存键详情</h2>
              </div>
              <button
                aria-label="关闭缓存键详情"
                className="cache-detail-close"
                onClick={closeDetail}
                type="button"
              >
                ×
              </button>
            </div>

            <dl className="cache-detail-meta">
              <div>
                <dt>键名</dt>
                <dd>{detail.key}</dd>
              </div>
              <div>
                <dt>类型</dt>
                <dd>{KEY_TYPE_LABEL[detail.type]}</dd>
              </div>
              <div>
                <dt>TTL</dt>
                <dd>
                  {formatTtl(detail.ttlSeconds)}
                  {!detail.canUpdateTtl ? (
                    <small className="cache-ttl-detail-note">
                      由登录策略统一管理
                    </small>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>内存</dt>
                <dd>{formatBytes(detail.memoryBytes)}</dd>
              </div>
              <div>
                <dt>元素数量</dt>
                <dd>{detail.length ?? "—"}</dd>
              </div>
              <div>
                <dt>显示状态</dt>
                <dd>{detail.truncated ? "内容已截断" : "完整显示"}</dd>
              </div>
            </dl>

            <div className="cache-value-heading">
              <strong>键值内容</strong>
              <button
                className="text-action"
                onClick={() => void copyDetailValue()}
                type="button"
              >
                复制脱敏内容
              </button>
            </div>
            <pre className="cache-value-viewer">
              {formatDetailValue(detail.value)}
            </pre>

            {detail.canUpdateTtl ? (
              <form
                className="cache-ttl-form"
                onSubmit={(event) => void handleTtlSubmit(event)}
              >
                <label>
                  <span>设置 TTL（秒）</span>
                  <input
                    inputMode="numeric"
                    max={31_536_000}
                    min={60}
                    onChange={(event) => setTtlDraft(event.target.value)}
                    required
                    type="number"
                    value={ttlDraft}
                  />
                </label>
                <button
                  className="table-action"
                  disabled={busyKey === detail.key}
                  type="submit"
                >
                  保存 TTL
                </button>
              </form>
            ) : null}

            <div className="cache-detail-actions">
              <span>{deleteActionHint(detail.category)}</span>
              <button
                className="cache-danger-action"
                disabled={isDeleting}
                onClick={() => void handleDelete([detail.key])}
                type="button"
              >
                {deleteActionLabel(detail.category)}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function CacheOverviewGrid({ overview }: { overview: CacheOverview }) {
  const memoryPercent =
    overview.maxMemoryBytes > 0
      ? overview.usedMemoryBytes / overview.maxMemoryBytes
      : null;
  const metrics = [
    { label: "Redis", value: `v${overview.redisVersion}` },
    { label: "缓存键", value: String(overview.keyCount) },
    { label: "已用内存", value: formatBytes(overview.usedMemoryBytes) },
    {
      label: "内存占比",
      value: memoryPercent === null ? "未限制" : formatPercent(memoryPercent),
    },
    { label: "连接数", value: String(overview.connectedClients) },
    {
      label: "命中率",
      value:
        overview.hitRate === null
          ? "暂无数据"
          : formatPercent(overview.hitRate),
    },
    { label: "已过期", value: String(overview.expiredKeys) },
    { label: "已淘汰", value: String(overview.evictedKeys) },
  ];

  return (
    <section aria-label="Redis 运行概览" className="cache-overview-grid">
      {metrics.map((metric) => (
        <div className="cache-metric" key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </section>
  );
}

function formatBytes(value: number | null): string {
  if (value === null || value < 0) {
    return "—";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB"];
  let amount = value / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(amount >= 100 ? 0 : amount >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatTtl(seconds: number): string {
  if (seconds === -1) {
    return "永久";
  }
  if (seconds < 0) {
    return "已失效";
  }
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分`;
  }
  return `${minutes} 分钟`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDetailValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function deleteActionLabel(category: CacheKeyCategory): string {
  switch (category) {
    case "refresh-session":
      return "撤销此会话";
    case "user-sessions":
      return "撤销全部会话";
    case "login-failure":
      return "清除失败计数";
    default:
      return "删除缓存键";
  }
}

function deleteActionHint(category: CacheKeyCategory): string {
  switch (category) {
    case "refresh-session":
      return "该设备需要重新登录。";
    case "user-sessions":
      return "该用户的全部设备需要重新登录。";
    case "login-failure":
      return "账号和 IP 的登录失败计数会被清除。";
    default:
      return "该缓存键会立即从 Redis 删除。";
  }
}

function buildDeleteConfirmation(
  keys: string[],
  summaries: CacheKeySummary[],
  detail: CacheKeyDetail | null,
): string {
  if (keys.length === 1) {
    const item =
      summaries.find((summary) => summary.key === keys[0]) ??
      (detail?.key === keys[0] ? detail : null);
    if (item) {
      return `${deleteActionLabel(item.category)}？${deleteActionHint(item.category)}`;
    }
  }
  return `确定处理选中的 ${keys.length} 个缓存键吗？其中的登录会话可能会立即失效。`;
}

function formatDeleteResult(result: {
  deletedKeys: number;
  revokedSessions: number;
  clearedLoginFailures: number;
}): string {
  const details = [`已删除 ${result.deletedKeys} 个键`];
  if (result.revokedSessions) {
    details.push(`撤销 ${result.revokedSessions} 个登录会话`);
  }
  if (result.clearedLoginFailures) {
    details.push(`清除 ${result.clearedLoginFailures} 项登录失败计数`);
  }
  return `${details.join("，")}。`;
}
