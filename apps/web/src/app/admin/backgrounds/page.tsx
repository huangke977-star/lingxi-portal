'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import {
  activateBackground,
  deleteBackground,
  listBackgrounds,
  ManagedBackground,
  notifyBackgroundChange,
  resolveBackgroundUrl,
  uploadBackgrounds,
} from '@/lib/background-api';
import { AuthUser, getMe } from '@/lib/auth-api';
import { readAccessToken } from '@/lib/auth-storage';

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 20;

export default function BackgroundManagementPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [backgrounds, setBackgrounds] = useState<ManagedBackground[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let isMounted = true;
    const token = readAccessToken();

    if (!token) {
      router.replace('/login');
      return;
    }

    async function loadBackgrounds(verifiedToken: string) {
      setError('');
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

        const nextBackgrounds = await listBackgrounds(verifiedToken);
        if (isMounted) {
          setBackgrounds(nextBackgrounds);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : '无法读取背景图片。');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadBackgrounds(token);
    return () => {
      isMounted = false;
    };
  }, [router]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || selectedFiles.length === 0) {
      setError('请选择背景图片。');
      setNotice('');
      return;
    }

    if (selectedFiles.length > MAX_FILES_PER_UPLOAD) {
      setError(`一次最多上传 ${MAX_FILES_PER_UPLOAD} 张图片。`);
      setNotice('');
      return;
    }

    const oversizedFile = selectedFiles.find((file) => file.size > MAX_FILE_SIZE);
    if (oversizedFile) {
      setError(`${oversizedFile.name} 超过 30 MB。`);
      setNotice('');
      return;
    }

    setIsUploading(true);
    setError('');
    setNotice('');
    try {
      const uploadedBackgrounds = await uploadBackgrounds(accessToken, selectedFiles);
      setBackgrounds((current) => [...uploadedBackgrounds, ...current]);
      setSelectedFiles([]);
      setNotice(`${uploadedBackgrounds.length} 张图片已上传，可设为全站背景。`);
      const input = document.getElementById('background-file') as HTMLInputElement | null;
      if (input) {
        input.value = '';
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '背景图片上传失败。');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleActivate(background: ManagedBackground) {
    if (!accessToken || background.isActive) {
      return;
    }

    setBusyId(background.id);
    setError('');
    setNotice('');
    try {
      const activeBackground = await activateBackground(accessToken, background.id);
      setBackgrounds((current) =>
        current.map((item) => ({ ...item, isActive: item.id === activeBackground.id })),
      );
      notifyBackgroundChange();
      setNotice(`已将 ${activeBackground.originalName} 设为全站背景。`);
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : '背景切换失败。');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(background: ManagedBackground) {
    if (!accessToken) {
      return;
    }

    const confirmed = window.confirm(
      background.isActive
        ? '删除当前全站背景后将恢复内置默认背景，确定删除吗？'
        : `确定从磁盘中永久删除 ${background.originalName} 吗？`,
    );
    if (!confirmed) {
      return;
    }

    setBusyId(background.id);
    setError('');
    setNotice('');
    try {
      await deleteBackground(accessToken, background.id);
      setBackgrounds((current) => current.filter((item) => item.id !== background.id));
      if (background.isActive) {
        notifyBackgroundChange();
      }
      setNotice('图片及其磁盘文件已删除。');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '背景图片删除失败。');
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>背景管理</h1>
        <div className="status-row">
          <span className="status">正在读取图片</span>
        </div>
      </section>
    );
  }

  if (!currentUser) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>无法进入背景管理</h1>
        <p>{error || '请重新登录后再访问。'}</p>
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
        <p>该页面仅超级管理员可查看。</p>
        <Link className="text-action primary" href="/dashboard">
          返回工作台
        </Link>
      </section>
    );
  }

  return (
    <section className="page-shell admin-shell background-admin-shell">
      <header className="page-header">
        <span className="eyebrow">HLOVET Admin</span>
        <div className="title-row">
          <div>
            <h1>背景管理</h1>
            <p>当前背景对所有用户生效，主题仅保留配色与透明度设置。</p>
          </div>
          <Link className="text-action" href="/admin">
            用户管理
          </Link>
        </div>
      </header>

      {error ? <p className="message error">{error}</p> : null}
      {notice ? <p className="message success">{notice}</p> : null}

      <form className="background-upload-panel" onSubmit={(event) => void handleUpload(event)}>
        <div>
          <span className="section-label">上传图片</span>
          <h2>添加全站背景</h2>
          <p>支持 JPEG、PNG、WebP、AVIF，单张不超过 30 MB。</p>
        </div>
        <div className="background-upload-controls">
          <label className="background-file-picker" htmlFor="background-file">
            <input
              accept="image/jpeg,image/png,image/webp,image/avif"
              disabled={isUploading}
              id="background-file"
              multiple
              onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
              type="file"
            />
            <span>{formatSelectedFiles(selectedFiles)}</span>
          </label>
          <button className="button" disabled={isUploading || selectedFiles.length === 0} type="submit">
            {isUploading ? '上传中' : '上传'}
          </button>
        </div>
      </form>

      <div className="background-list-heading">
        <div>
          <span className="section-label">图片库</span>
          <h2>{backgrounds.length} 张已上传图片</h2>
        </div>
        <span className="background-current-state">
          {backgrounds.some((background) => background.isActive) ? '已设置全站背景' : '使用内置默认背景'}
        </span>
      </div>

      {backgrounds.length ? (
        <div className="background-gallery">
          {backgrounds.map((background) => {
            const isBusy = busyId === background.id;
            return (
              <article className={`background-card${background.isActive ? ' active' : ''}`} key={background.id}>
                <div
                  aria-label={`背景预览：${background.originalName}`}
                  className="background-preview"
                  role="img"
                  style={{ backgroundImage: `url("${resolveBackgroundUrl(background)}")` }}
                >
                  {background.isActive ? <span className="background-active-badge">当前使用</span> : null}
                </div>
                <div className="background-card-body">
                  <div className="background-card-copy">
                    <strong title={background.originalName}>{background.originalName}</strong>
                    <span>
                      {formatFileSize(background.sizeBytes)} · {formatDate(background.createdAt)} · {background.uploadedBy.username}
                    </span>
                  </div>
                  <div className="background-card-actions">
                    {!background.isActive ? (
                      <button
                        className="text-action primary"
                        disabled={isBusy}
                        onClick={() => void handleActivate(background)}
                        type="button"
                      >
                        {isBusy ? '设置中' : '设为全站背景'}
                      </button>
                    ) : null}
                    <button
                      className="text-action danger-text"
                      disabled={isBusy}
                      onClick={() => void handleDelete(background)}
                      type="button"
                    >
                      {isBusy ? '处理中' : '永久删除'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="background-empty-state">
          <strong>暂无上传图片</strong>
          <p>当前使用 HLOVET 内置默认背景。</p>
        </div>
      )}
    </section>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatSelectedFiles(files: File[]): string {
  if (files.length === 0) {
    return '选择图片';
  }

  if (files.length === 1) {
    return files[0].name;
  }

  return `已选择 ${files.length} 张图片`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value));
}
