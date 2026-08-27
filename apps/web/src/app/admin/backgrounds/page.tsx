'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { AppToast } from '@/components/app-toast';
import { useConfirm } from '@/components/confirm-dialog';
import { AdminPageHeader, AdminPageLoading } from '@/components/admin-page-header';
import { useLanguage } from '@/components/language-provider';
import {
  activateBackground,
  deleteBackground,
  listBackgrounds,
  ManagedBackground,
  notifyBackgroundChange,
  resolveBackgroundUrl,
  uploadBackgrounds,
} from '@/lib/background-api';
import { AuthUser, getMe, isAuthExpiredError } from '@/lib/auth-api';
import { clearAuthTokens, readAccessToken } from '@/lib/auth-storage';
import { localizedPath } from '@/lib/i18n';

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 20;

export default function BackgroundManagementPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const { confirm } = useConfirm();
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
      router.replace(localizedPath('/login', locale));
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
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(localizedPath('/', locale));
          return;
        }

        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : phrase('无法读取背景图片。', 'Could not load background images.'));
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
  }, [locale, phrase, router]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || selectedFiles.length === 0) {
      setError(phrase('请选择背景图片。', 'Choose background images first.'));
      setNotice('');
      return;
    }

    if (selectedFiles.length > MAX_FILES_PER_UPLOAD) {
      setError(phrase(`一次最多上传 ${MAX_FILES_PER_UPLOAD} 张图片。`, `Upload at most ${MAX_FILES_PER_UPLOAD} images at once.`));
      setNotice('');
      return;
    }

    const oversizedFile = selectedFiles.find((file) => file.size > MAX_FILE_SIZE);
    if (oversizedFile) {
      setError(phrase(`${oversizedFile.name} 超过 30 MB。`, `${oversizedFile.name} exceeds 30 MB.`));
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
      setNotice(phrase(`${uploadedBackgrounds.length} 张图片已上传，可设为全站背景。`, `${uploadedBackgrounds.length} image(s) uploaded and ready to use as the site background.`));
      const input = document.getElementById('background-file') as HTMLInputElement | null;
      if (input) {
        input.value = '';
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : phrase('背景图片上传失败。', 'Could not upload background images.'));
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
      setNotice(phrase(`已将 ${activeBackground.originalName} 设为全站背景。`, `${activeBackground.originalName} is now the site background.`));
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : phrase('背景切换失败。', 'Could not change site background.'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(background: ManagedBackground) {
    if (!accessToken) {
      return;
    }

    const confirmed = await confirm(
      background.isActive
        ? phrase('删除当前全站背景后将恢复内置默认背景，确定删除吗？', 'Deleting the active background restores the built-in default. Continue?')
        : phrase(`确定从磁盘中永久删除 ${background.originalName} 吗？`, `Permanently delete ${background.originalName} from disk?`),
      { danger: true },
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
      setNotice(phrase('图片及其磁盘文件已删除。', 'Image and source file deleted.'));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : phrase('背景图片删除失败。', 'Could not delete background image.'));
    } finally {
      setBusyId(null);
    }
  }

  const pageDescription = phrase('管理登录页和站点使用的背景图片。', 'Manage backgrounds used by the sign-in page and site.');

  if (isLoading) return <AdminPageLoading className="background-admin-shell" description={pageDescription} loadingLabel={phrase('正在读取图片', 'Loading images')} title={phrase('背景管理', 'Background management')} />;

  if (!currentUser) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>{phrase('无法进入背景管理', 'Cannot open background management')}</h1>
        <p>{error || phrase('请重新登录后再访问。', 'Sign in again to continue.')}</p>
        <Link className="text-action primary" href={localizedPath('/login', locale)}>
          {phrase('返回登录', 'Back to sign in')}
        </Link>
      </section>
    );
  }

  if (!currentUser.isSuperAdmin) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>{phrase('无权访问', 'Access denied')}</h1>
        <p>{phrase('该页面仅超级管理员可查看。', 'This page is available only to the super administrator.')}</p>
        <Link className="text-action primary" href={localizedPath('/dashboard', locale)}>
          {phrase('返回工作台', 'Back to workspace')}
        </Link>
      </section>
    );
  }

  return (
    <section className="page-shell admin-shell background-admin-shell">
      <AppToast
        duration={error ? 4200 : 2600}
        message={error || notice}
        onDismiss={() => {
          setError('');
          setNotice('');
        }}
        tone={error ? 'error' : 'success'}
      />

      <AdminPageHeader description={pageDescription} title={phrase('背景管理', 'Background management')} />
      <form className="background-upload-panel" onSubmit={(event) => void handleUpload(event)}>
        <div>
          <span className="section-label">{phrase('上传图片', 'UPLOAD IMAGES')}</span>
          <h2>{phrase('添加全站背景', 'Add site backgrounds')}</h2>
          <p>{phrase('支持 JPEG、PNG、WebP、AVIF，每次最多 5 张、单张原图不超过 30 MB，上传后自动压缩为 WebP。', 'Supports JPEG, PNG, WebP, and AVIF. Upload up to 5 images at once, 30 MB each, then they are compressed to WebP.')}</p>
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
            <span>{formatSelectedFiles(selectedFiles, phrase)}</span>
          </label>
          <button className="button" disabled={isUploading || selectedFiles.length === 0} type="submit">
            {isUploading ? phrase('上传中', 'Uploading') : phrase('上传', 'Upload')}
          </button>
        </div>
      </form>

      <div className="background-list-heading">
        <div>
          <span className="section-label">{phrase('图片库', 'IMAGE LIBRARY')}</span>
          <h2>{phrase(`${backgrounds.length} 张已上传图片`, `${backgrounds.length} uploaded images`)}</h2>
        </div>
        <span className="background-current-state">
          {backgrounds.some((background) => background.isActive) ? phrase('已设置全站背景', 'Custom site background active') : phrase('使用内置默认背景', 'Using built-in default background')}
        </span>
      </div>

      {backgrounds.length ? (
        <div className="background-gallery">
          {backgrounds.map((background) => {
            const isBusy = busyId === background.id;
            return (
              <article className={`background-card${background.isActive ? ' active' : ''}`} key={background.id}>
                <div
                  aria-label={phrase(`背景预览：${background.originalName}`, `Background preview: ${background.originalName}`)}
                  className="background-preview"
                  role="img"
                  style={{ backgroundImage: `url("${resolveBackgroundUrl(background)}")` }}
                >
                  {background.isActive ? <span className="background-active-badge">{phrase('当前使用', 'Active')}</span> : null}
                </div>
                <div className="background-card-body">
                  <div className="background-card-copy">
                    <strong title={background.originalName}>{background.originalName}</strong>
                    <span>
                      {formatFileSize(background.sizeBytes)} · {formatDate(background.createdAt, locale)} · {background.uploadedBy.username}
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
                        {isBusy ? phrase('设置中', 'Applying') : phrase('设为全站背景', 'Set as site background')}
                      </button>
                    ) : null}
                    <button
                      className="text-action danger-text"
                      disabled={isBusy}
                      onClick={() => void handleDelete(background)}
                      type="button"
                    >
                      {isBusy ? phrase('处理中', 'Processing') : phrase('永久删除', 'Delete permanently')}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="background-empty-state">
          <strong>{phrase('暂无上传图片', 'No uploaded images')}</strong>
          <p>{phrase('当前使用 HLOVET 内置默认背景。', 'The HLOVET built-in default background is active.')}</p>
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

function formatSelectedFiles(files: File[], phrase: (chinese: string, english: string) => string): string {
  if (files.length === 0) {
    return phrase('选择图片', 'Choose images');
  }

  if (files.length === 1) {
    return files[0].name;
  }

  return phrase(`已选择 ${files.length} 张图片`, `${files.length} images selected`);
}

function formatDate(value: string, locale: 'zh-CN' | 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
}
