"use client";

import Link from "next/link";
import { RefreshCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
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

type InlinePhrase = (chinese: string, english: string) => string;

function categoryLabel(category: CacheKeyCategory, phrase: InlinePhrase) {
  const labels: Record<CacheKeyCategory, [string, string]> = {
    "refresh-session": ["登录会话", "Sign-in sessions"],
    "user-sessions": ["用户会话索引", "User session index"],
    "login-failure": ["登录失败计数", "Failed sign-in counter"],
    "business-cache": ["业务缓存", "Business cache"],
  };
  const [chinese, english] = labels[category];
  return phrase(chinese, english);
}

export default function CacheManagementPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
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
      router.replace(localizedPath("/login", locale));
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
          router.replace(localizedPath("/", locale));
          return;
        }
        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : phrase("无法读取 Redis 状态。", "Could not load Redis status."),
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
  }, [locale, phrase, router]);

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
          router.replace(localizedPath("/", locale));
          return;
        }
        if (isMounted) {
          setError(
            loadError instanceof Error ? loadError.message : phrase("无法读取缓存键。", "Could not load cache keys."),
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
    locale,
    phrase,
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
            router.replace(localizedPath("/", locale));
          }
        });
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [accessToken, currentUser, locale, router]);

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
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : phrase("刷新 Redis 状态失败。", "Could not refresh Redis status."),
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
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(
        detailError instanceof Error ? detailError.message : phrase("读取键值失败。", "Could not load the cache value."),
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
      phrase(buildDeleteConfirmation(keys, keyPage?.keys ?? [], detail), buildDeleteConfirmationEnglish(keys, keyPage?.keys ?? [], detail)),
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
      setNotice(phrase(formatDeleteResult(result), formatDeleteResultEnglish(result)));
    } catch (deleteError) {
      if (isAuthExpiredError(deleteError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(
        deleteError instanceof Error ? deleteError.message : phrase("缓存键操作失败。", "Could not update cache keys."),
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
      setError(phrase("TTL 必须是 60 到 31536000 之间的整数秒。", "TTL must be an integer between 60 and 31,536,000 seconds."));
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
      setNotice(phrase("缓存键 TTL 已更新。", "Cache key TTL updated."));
    } catch (ttlError) {
      if (isAuthExpiredError(ttlError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(ttlError instanceof Error ? ttlError.message : phrase("TTL 更新失败。", "Could not update TTL."));
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
      setError(phrase("TTL 必须是 60 到 31536000 之间的整数秒。", "TTL must be an integer between 60 and 31,536,000 seconds."));
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
      setNotice(phrase(`已更新 ${updated.length} 个缓存键的 TTL。`, `Updated the TTL for ${updated.length} cache keys.`));
    } catch (ttlError) {
      if (isAuthExpiredError(ttlError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(
        ttlError instanceof Error ? ttlError.message : phrase("批量修改 TTL 失败。", "Could not update TTL in bulk."),
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
    setNotice(phrase("已复制当前显示的脱敏内容。", "The masked value was copied."));
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
        <h1>{phrase("缓存管理", "Cache management")}</h1>
        <div className="status-row">
          <span className="status">{phrase("正在连接 Redis", "Connecting to Redis")}</span>
        </div>
      </section>
    );
  }

  if (!currentUser) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>{phrase("无法进入缓存管理", "Could not open cache management")}</h1>
        <p>{error || phrase("请重新登录后再访问。", "Sign in again to continue.")}</p>
        <Link className="text-action primary" href={localizedPath("/login", locale)}>
          {phrase("返回登录", "Back to sign in")}
        </Link>
      </section>
    );
  }

  if (!currentUser.isSuperAdmin) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>{phrase("无权访问", "Access denied")}</h1>
        <p>{phrase("缓存数据仅超级管理员可查看和操作。", "Only super administrators can view and manage cache data.")}</p>
        <Link className="text-action primary" href={localizedPath("/dashboard", locale)}>
          {phrase("返回工作台", "Back to workspace")}
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
        <button aria-label={phrase("刷新缓存数据", "Refresh cache data")} disabled={isOverviewRefreshing} onClick={() => void refreshOverview()} title={phrase("刷新缓存数据", "Refresh cache data")} type="button">
          <RefreshCcw aria-hidden="true" className={isOverviewRefreshing ? "spinning" : undefined} size={17} />
        </button>
      </div>

      {overview ? <CacheOverviewGrid overview={overview} phrase={phrase} /> : null}

      <div className="cache-table-heading">
        <div>
          <span className="section-label">CACHE KEYS</span>
          <h2>{phrase("缓存键", "Cache keys")}</h2>
        </div>
      </div>

      <div className="cache-toolbar">
        <label className="cache-search-field">
          <span>{phrase("搜索键名", "Search keys")}</span>
          <input
            maxLength={128}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={phrase("输入完整键名或部分内容", "Enter a full key or partial value")}
            type="search"
            value={searchDraft}
          />
        </label>
        <label>
          <span>{phrase("缓存分类", "Cache category")}</span>
          <GlassSelect
            ariaLabel={phrase("缓存分类", "Cache category")}
            onChange={(value) => {
              setCursor("0");
              setCursorHistory([]);
              setCategoryFilter(value);
            }}
            options={[{ value: "", label: phrase("全部分类", "All categories") }, ...Object.keys(CATEGORY_LABEL).map((category) => ({ value: category, label: categoryLabel(category as CacheKeyCategory, phrase) }))]}
            value={categoryFilter}
          />
        </label>
        <label>
          <span>{phrase("数据类型", "Data type")}</span>
          <GlassSelect
            ariaLabel={phrase("数据类型", "Data type")}
            onChange={(value) => {
              setCursor("0");
              setCursorHistory([]);
              setTypeFilter(value);
            }}
            options={[{ value: "", label: phrase("全部类型", "All types") }, ...Object.keys(KEY_TYPE_LABEL).filter((type) => type !== "none").map((type) => ({ value: type, label: KEY_TYPE_LABEL[type as CacheKeyType] }))]}
            value={typeFilter}
          />
        </label>
        <label>
          <span>{phrase("每页数量", "Items per page")}</span>
          <GlassSelect
            ariaLabel={phrase("每页数量", "Items per page")}
            onChange={(value) => {
              setCursor("0");
              setCursorHistory([]);
              setBatchSize(Number(value));
            }}
            options={[10, 20, 50, 100].map((value) => ({ value: String(value), label: phrase(`${value} 条`, `${value} items`) }))}
            value={String(batchSize)}
          />
        </label>
      </div>

      {selectedKeys.length ? (
        <div className="cache-selection-bar">
          <span className="cache-selection-summary">
            <span>
              {phrase("已选择", "Selected")} <strong>{selectedKeys.length}</strong> {phrase("项，其中", "items, with")} {" "}
              <strong>{ttlEditableSelectedKeys.length}</strong> {phrase("项可修改 TTL", "eligible for TTL updates")}
            </span>
            {ttlEditableSelectedKeys.length === 0 ? (
              <small>{phrase("当前选择的是认证缓存，TTL 由登录策略统一管理。", "The selected authentication cache has a TTL controlled by sign-in policy.")}</small>
            ) : null}
          </span>
          <div className="cache-selection-actions">
            <button
              className="text-action"
              disabled={ttlEditableSelectedKeys.length === 0}
              onClick={openBulkTtl}
              title={
                ttlEditableSelectedKeys.length
                  ? phrase("批量修改已选业务缓存的 TTL", "Update TTL for selected business cache")
                  : phrase("登录相关缓存不允许修改 TTL", "Sign-in cache TTL cannot be changed")
              }
              type="button"
            >
              {phrase("修改 TTL", "Update TTL")} ({ttlEditableSelectedKeys.length})
            </button>
           <button
             className="cache-danger-action"
             disabled={isDeleting}
             onClick={() => void handleDelete(selectedKeys)}
             type="button"
           >
              {phrase("删除/清理选中项", "Delete selected")}
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
                  aria-label={phrase("选择当前批次全部缓存键", "Select all cache keys in this batch")}
                  checked={allCurrentKeysSelected}
                  onChange={toggleCurrentPage}
                  type="checkbox"
                />
              </th>
              <th>{phrase("键名", "Key")}</th>
              <th>{phrase("分类", "Category")}</th>
              <th>{phrase("类型", "Type")}</th>
              <th>TTL</th>
              <th>{phrase("内存", "Memory")}</th>
              <th>{phrase("操作", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {isKeysLoading ? (
              <tr>
                <td className="admin-table-state" colSpan={7}>
                  {phrase("正在扫描缓存键", "Scanning cache keys")}
                </td>
              </tr>
            ) : keyPage?.keys.length ? (
              keyPage.keys.map((item) => (
                <tr key={item.key}>
                  <td className="cache-select-cell">
                    <input
                      aria-label={phrase(`选择缓存键 ${item.key}`, `Select cache key ${item.key}`)}
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
                  <td>{categoryLabel(item.category, phrase)}</td>
                  <td>
                    <span className={`cache-type-badge ${item.type}`}>
                      {KEY_TYPE_LABEL[item.type]}
                    </span>
                  </td>
                  <td>
                    <span className="cache-ttl-display">
                      <span>{formatTtl(item.ttlSeconds, phrase)}</span>
                      {!item.canUpdateTtl ? (
                        <small title={phrase("认证缓存 TTL 由登录策略统一管理", "Authentication cache TTL is controlled by sign-in policy")}>
                          {phrase("系统管理", "System managed")}
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
                      {busyKey === item.key ? phrase("读取中", "Loading") : phrase("查看", "View")}
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="admin-table-state" colSpan={7}>
                  {phrase("没有找到匹配的缓存键", "No matching cache keys found")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <nav aria-label={phrase("缓存键游标分页", "Cache key cursor pagination")} className="admin-pagination">
        <span>{keyPage?.done ? phrase("已到当前扫描末尾", "End of current scan") : phrase("Redis 游标分批加载", "Loaded in Redis cursor batches")}</span>
        <div>
          <button
            disabled={isKeysLoading || cursorHistory.length === 0}
            onClick={goPrevious}
            type="button"
          >
            {phrase("上一批", "Previous batch")}
          </button>
          <button
            disabled={isKeysLoading || !keyPage || keyPage.done}
            onClick={goNext}
            type="button"
          >
            {phrase("下一批", "Next batch")}
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
              <h2 id="bulk-ttl-title">{phrase("批量修改 TTL", "Update TTL in bulk")}</h2>
              <p>
                {phrase(`将同时修改 ${ttlEditableSelectedKeys.length} 个已选业务缓存，登录相关缓存不会包含在内。`, `This updates ${ttlEditableSelectedKeys.length} selected business cache keys. Sign-in cache is excluded.`)}
              </p>
            </div>
            <form
              className="form-stack modal-form"
              onSubmit={(event) => void handleBulkTtlSubmit(event)}
            >
              <label>
                <span>{phrase("TTL（秒）", "TTL (seconds)")}</span>
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
                  {isBulkTtlUpdating ? phrase("保存中", "Saving") : phrase("保存 TTL", "Save TTL")}
                </button>
                <button
                  className="button secondary"
                  disabled={isBulkTtlUpdating}
                  onClick={() => setIsBulkTtlOpen(false)}
                  type="button"
                >
                  {phrase("取消", "Cancel")}
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
                  {categoryLabel(detail.category, phrase)}
                </span>
                <h2 id="cache-detail-title">{phrase("缓存键详情", "Cache key details")}</h2>
              </div>
              <button
                aria-label={phrase("关闭缓存键详情", "Close cache key details")}
                className="cache-detail-close"
                onClick={closeDetail}
                type="button"
              >
                ×
              </button>
            </div>

            <dl className="cache-detail-meta">
              <div>
                <dt>{phrase("键名", "Key")}</dt>
                <dd>{detail.key}</dd>
              </div>
              <div>
                <dt>{phrase("类型", "Type")}</dt>
                <dd>{KEY_TYPE_LABEL[detail.type]}</dd>
              </div>
              <div>
                <dt>TTL</dt>
                <dd>
                  {formatTtl(detail.ttlSeconds, phrase)}
                  {!detail.canUpdateTtl ? (
                    <small className="cache-ttl-detail-note">
                      {phrase("由登录策略统一管理", "Controlled by sign-in policy")}
                    </small>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>{phrase("内存", "Memory")}</dt>
                <dd>{formatBytes(detail.memoryBytes)}</dd>
              </div>
              <div>
                <dt>{phrase("元素数量", "Element count")}</dt>
                <dd>{detail.length ?? "—"}</dd>
              </div>
              <div>
                <dt>{phrase("显示状态", "Display state")}</dt>
                <dd>{detail.truncated ? phrase("内容已截断", "Content truncated") : phrase("完整显示", "Full content")}</dd>
              </div>
            </dl>

            <div className="cache-value-heading">
              <strong>{phrase("键值内容", "Cache value")}</strong>
              <button
                className="text-action"
                onClick={() => void copyDetailValue()}
                type="button"
              >
                {phrase("复制脱敏内容", "Copy masked value")}
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
                  <span>{phrase("设置 TTL（秒）", "Set TTL (seconds)")}</span>
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
                  {phrase("保存 TTL", "Save TTL")}
                </button>
              </form>
            ) : null}

            <div className="cache-detail-actions">
              <span>{phrase(deleteActionHint(detail.category), deleteActionHintEnglish(detail.category))}</span>
              <button
                className="cache-danger-action"
                disabled={isDeleting}
                onClick={() => void handleDelete([detail.key])}
                type="button"
              >
                {phrase(deleteActionLabel(detail.category), deleteActionLabelEnglish(detail.category))}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function CacheOverviewGrid({ overview, phrase }: { overview: CacheOverview; phrase: InlinePhrase }) {
  const memoryPercent =
    overview.maxMemoryBytes > 0
      ? overview.usedMemoryBytes / overview.maxMemoryBytes
      : null;
  const metrics = [
    { label: "Redis", value: `v${overview.redisVersion}` },
    { label: phrase("缓存键", "Cache keys"), value: String(overview.keyCount) },
    { label: phrase("已用内存", "Memory used"), value: formatBytes(overview.usedMemoryBytes) },
    {
      label: phrase("内存占比", "Memory usage"),
      value: memoryPercent === null ? phrase("未限制", "Unlimited") : formatPercent(memoryPercent),
    },
    { label: phrase("连接数", "Connections"), value: String(overview.connectedClients) },
    {
      label: phrase("命中率", "Hit rate"),
      value:
        overview.hitRate === null
          ? phrase("暂无数据", "No data")
          : formatPercent(overview.hitRate),
    },
    { label: phrase("已过期", "Expired"), value: String(overview.expiredKeys) },
    { label: phrase("已淘汰", "Evicted"), value: String(overview.evictedKeys) },
  ];

  return (
    <section aria-label={phrase("Redis 运行概览", "Redis overview")} className="cache-overview-grid">
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

function formatTtl(seconds: number, phrase: InlinePhrase): string {
  if (seconds === -1) {
    return phrase("永久", "Permanent");
  }
  if (seconds < 0) {
    return phrase("已失效", "Expired");
  }
  if (seconds < 60) {
    return phrase(`${seconds} 秒`, `${seconds} seconds`);
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) {
    return phrase(`${days} 天 ${hours} 小时`, `${days}d ${hours}h`);
  }
  if (hours > 0) {
    return phrase(`${hours} 小时 ${minutes} 分`, `${hours}h ${minutes}m`);
  }
  return phrase(`${minutes} 分钟`, `${minutes} min`);
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

function deleteActionLabelEnglish(category: CacheKeyCategory): string {
  switch (category) {
    case "refresh-session": return "Revoke this session";
    case "user-sessions": return "Revoke all sessions";
    case "login-failure": return "Clear failure counter";
    default: return "Delete cache key";
  }
}

function deleteActionHintEnglish(category: CacheKeyCategory): string {
  switch (category) {
    case "refresh-session": return "This device must sign in again.";
    case "user-sessions": return "All devices for this user must sign in again.";
    case "login-failure": return "Failed sign-in counters for the account and IP will be cleared.";
    default: return "This cache key will be deleted from Redis immediately.";
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

function buildDeleteConfirmationEnglish(
  keys: string[],
  summaries: CacheKeySummary[],
  detail: CacheKeyDetail | null,
): string {
  if (keys.length === 1) {
    const item = summaries.find((summary) => summary.key === keys[0]) ?? (detail?.key === keys[0] ? detail : null);
    if (item) return `${deleteActionLabelEnglish(item.category)}? ${deleteActionHintEnglish(item.category)}`;
  }
  return `Process ${keys.length} selected cache keys? Active sign-in sessions may expire immediately.`;
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

function formatDeleteResultEnglish(result: { deletedKeys: number; revokedSessions: number; clearedLoginFailures: number }): string {
  const details = [`Deleted ${result.deletedKeys} keys`];
  if (result.revokedSessions) details.push(`revoked ${result.revokedSessions} sign-in sessions`);
  if (result.clearedLoginFailures) details.push(`cleared ${result.clearedLoginFailures} failed sign-in counters`);
  return `${details.join(", ")}.`;
}
