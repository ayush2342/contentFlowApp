import { mapTreeOutputJson } from '../utils/jsonMapper';

const DEFAULT_CONTEXT = {
  outputId: import.meta.env.VITE_DEFAULT_OUTPUT_ID || '',
  tenantId: import.meta.env.VITE_DEFAULT_TENANT_ID || '',
  documentId: import.meta.env.VITE_DEFAULT_DOCUMENT_ID || '',
  clientName: import.meta.env.VITE_DEFAULT_CLIENT_NAME || '',
  templateId: import.meta.env.VITE_DEFAULT_TEMPLATE_ID || 'theme2',
};

const getApiBaseUrl = () =>
  (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api').replace(/\/+$/, '');

const CONTEXT_STORAGE_KEY = 'contentflow-output-context';

const hasMappedChapters = (mapped) =>
  Array.isArray(mapped?.books) &&
  mapped.books.some((book) => Array.isArray(book?.chapters) && book.chapters.length > 0);

const normalizeText = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const slugify = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '');

const ensureChapterFallback = (mapped, sourceData, context) => {
  if (hasMappedChapters(mapped)) return mapped;

  const pages = Array.isArray(sourceData?.pages) ? sourceData.pages : [];
  if (!pages.length) return mapped;

  const chapterTitle =
    normalizeText(
      pages
        .flatMap((page) => (Array.isArray(page?.content) ? page.content : []))
        .find((block) => String(block?.type || '').toLowerCase() === 'chaptertitle')?.data?.text
    ) || 'Chapter';

  const chapterNumberText = normalizeText(
    pages
      .flatMap((page) => (Array.isArray(page?.content) ? page.content : []))
      .find((block) => String(block?.type || '').toLowerCase() === 'chapternumber')?.data?.text
  );
  const chapterNumberMatch = chapterNumberText.match(/(\d+)/);
  const chapterNumber = chapterNumberMatch ? Number(chapterNumberMatch[1]) : null;

  const chapterId = `chapter-${slugify(chapterTitle || chapterNumber || context.documentId || '1') || '1'}`;
  const bookId = slugify(chapterTitle || context.documentId || context.outputId || 'course') || 'course';

  return {
    ...mapped,
    bookId,
    books: [
      {
        id: bookId,
        title: chapterTitle,
        description: '',
        chapters: [
          {
            id: chapterId,
            chapterNumber,
            title: chapterTitle,
            description: '',
            outline: [],
            lessons: [],
          },
        ],
      },
    ],
  };
};

const readStoredContext = () => {
  try {
    const raw = window.sessionStorage.getItem(CONTEXT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
};

const writeStoredContext = (context) => {
  try {
    window.sessionStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(context));
  } catch {
    // Ignore storage failures; runtime context still works for current page.
  }
};

export const getRouteContext = () => {
  const searchParams = new URLSearchParams(window.location.search);
  const outputPathMatch = window.location.pathname.match(/\/output\/([^/?#]+)/);
  const storedContext = readStoredContext();

  const context = {
    outputId:
      outputPathMatch?.[1] ||
      searchParams.get('outputId') ||
      storedContext.outputId ||
      DEFAULT_CONTEXT.outputId,
    tenantId: searchParams.get('tenantId') || storedContext.tenantId || DEFAULT_CONTEXT.tenantId,
    documentId:
      searchParams.get('documentId') ||
      storedContext.documentId ||
      DEFAULT_CONTEXT.documentId,
    clientName: searchParams.get('clientName') || storedContext.clientName || DEFAULT_CONTEXT.clientName,
    templateId:
      searchParams.get('templateId') ||
      storedContext.templateId ||
      DEFAULT_CONTEXT.templateId ||
      'theme2',
  };

  if (context.outputId || (context.tenantId && context.documentId)) {
    writeStoredContext(context);
  }

  return context;
};

export const getCourseData = async (inputContext = null) => {
  const context = {
    ...getRouteContext(),
    ...(inputContext || {}),
  };
  const query = new URLSearchParams();
  if (context.clientName) query.set('clientName', context.clientName);
  if (context.templateId) query.set('templateId', context.templateId);
  const queryText = query.toString();

  const endpoint = context.outputId
    ? `${getApiBaseUrl()}/output/${context.outputId}/document`
    : `${getApiBaseUrl()}/document/${context.tenantId}/${context.documentId}${
        queryText ? `?${queryText}` : ''
      }`;

  if (!context.outputId && (!context.tenantId || !context.documentId)) {
    throw new Error(
      'Missing output context. Open the app using URL returned by /api/output.'
    );
  }

  // TODO(phase-2): add conditional fetch with ETag (If-None-Match) or client cache.
  // Phase 1 intentionally fetches fresh JSON on every render request.
  const response = await fetch(endpoint);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.message || `Failed to fetch document (${response.status})`);
  }

  const payload = await response.json();
  const resolvedTenantId = payload.tenantId || context.tenantId;
  const resolvedTemplateId = payload.templateId || context.templateId || 'theme2';
  const sourceData =
    payload?.data?.data ??
    payload?.data?.document ??
    payload?.data?.output ??
    payload?.data ??
    payload?.document ??
    payload?.output ??
    payload;

  // Persist theme from session/document response so the URL can stay clean.
  writeStoredContext({
    ...context,
    tenantId: resolvedTenantId,
    documentId: payload.documentId || context.documentId,
    templateId: resolvedTemplateId,
  });

  const mapped = mapTreeOutputJson(sourceData, {
    mediaBaseUrl: `${getApiBaseUrl()}/media`,
    tenantId: resolvedTenantId,
  });
  const resilientMapped = ensureChapterFallback(mapped, sourceData, context);

  return {
    ...resilientMapped,
    // TODO(phase-2): use etag/lastModified in client-side cache key if we add local caching.
    templateId: resolvedTemplateId,
    etag: payload.etag,
    lastModified: payload.lastModified,
  };
};

export const getBookById = (courseData, bookId) =>
  courseData?.books?.find((book) => book.id === bookId) ?? null;

export const getChapterById = (courseData, chapterId) => {
  for (const book of courseData?.books ?? []) {
    const chapter = book.chapters?.find((ch) => ch.id === chapterId);
    if (chapter) return { book, chapter };
  }
  return null;
};

export const getLessonById = (courseData, lessonId) => {
  for (const book of courseData?.books ?? []) {
    for (const chapter of book.chapters ?? []) {
      const lesson = chapter.lessons?.find((ls) => ls.id === lessonId);
      if (lesson) return { book, chapter, lesson };
    }
  }
  return null;
};
