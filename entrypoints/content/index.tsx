import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./content.css";

type Adjustments = {
  temperature: number;
  tint: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture: number;
  clarity: number;
  dehaze: number;
  vibrance: number;
  saturation: number;
};

type ImageRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type RetouchButtonPosition = {
  left: number;
  top: number;
};

type HiddenDriveControl = {
  element: HTMLElement;
  visibility: string;
  pointerEvents: string;
};

type FilterValues = {
  whiteBalanceMatrix: string;
  exposureTone: {
    slope: number;
    intercept: number;
  };
  toneCurve: string;
  saturation: number;
  detail: {
    amount: number;
    radius: number;
  };
};

const defaultAdjustments: Adjustments = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  vibrance: 0,
  saturation: 0,
};

const filterId = "drive-retouch-filter";
const rootId = "drive-retouch-root";
const retouchButtonWidth = 112;
const toneCurveSampleCount = 17;

export default defineContentScript({
  matches: ["https://drive.google.com/*"],
  main() {
    const existingRoot = document.getElementById(rootId);
    if (existingRoot) return;

    const root = document.createElement("div");
    root.id = rootId;
    document.documentElement.appendChild(root);

    createRoot(root).render(<RetouchApp />);
  },
});

function findLargestVisibleImage(): HTMLImageElement | null {
  const images = Array.from(document.images);

  const visibleImages = images
    .map((img) => {
      const rect = img.getBoundingClientRect();
      const area = rect.width * rect.height;

      return {
        img,
        rect,
        area,
      };
    })
    .filter(({ img, rect, area }) => {
      if (img.closest(`#${rootId}`)) {
        return false;
      }

      const style = window.getComputedStyle(img);

      return (
        area > 50_000 &&
        rect.width > 200 &&
        rect.height > 200 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        img.currentSrc
      );
    })
    .sort((a, b) => b.area - a.area);

  return visibleImages[0]?.img ?? null;
}

function getImageRect(img: HTMLImageElement): ImageRect {
  const rect = img.getBoundingClientRect();

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function getRetouchButtonPosition(): RetouchButtonPosition | null {
  const openWithLabels = ["アプリで開く", "Open with"];
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("[aria-label]"),
  )
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const label = element.getAttribute("aria-label") ?? "";

      return {
        element,
        label,
        rect,
      };
    })
    .filter(({ element, label, rect }) => {
      if (element.closest(`#${rootId}`)) {
        return false;
      }

      const style = window.getComputedStyle(element);

      return (
        openWithLabels.some((value) => label.includes(value)) &&
        rect.width >= 96 &&
        rect.height >= 28 &&
        rect.top >= 0 &&
        rect.top < 72 &&
        rect.left > window.innerWidth * 0.45 &&
        rect.right <= window.innerWidth &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    })
    .sort((a, b) => a.rect.top - b.rect.top || b.rect.right - a.rect.right);

  const anchor = candidates[0];

  if (!anchor) {
    return null;
  }

  return {
    left: Math.max(12, anchor.rect.left - retouchButtonWidth - 12),
    top: Math.max(8, anchor.rect.top + (anchor.rect.height - 32) / 2),
  };
}

function getControlLabel(element: HTMLElement): string {
  return [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("data-tooltip"),
    element.getAttribute("data-tooltip-text"),
    element.textContent,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isDriveZoomControl(element: HTMLElement): boolean {
  if (element.closest(`#${rootId}`)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.top < 0 ||
    rect.top > 160 ||
    rect.left < 0 ||
    rect.right > window.innerWidth ||
    style.display === "none" ||
    style.visibility === "hidden"
  ) {
    return false;
  }

  const label = getControlLabel(element).toLowerCase();
  const matchesZoomLabel =
    label.includes("zoom in") ||
    label.includes("zoom out") ||
    label.includes("ズームイン") ||
    label.includes("ズームアウト") ||
    label.includes("拡大") ||
    label.includes("縮小");

  if (matchesZoomLabel) {
    return true;
  }

  const compactText = (element.textContent ?? "").trim();

  return rect.width <= 64 && ["+", "-", "−"].includes(compactText);
}

function hideDriveZoomControls(): HiddenDriveControl[] {
  const controls = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button, [role="button"], [aria-label], [title], [data-tooltip], [data-tooltip-text]',
    ),
  ).filter(isDriveZoomControl);

  return controls.map((element) => {
    const previous = {
      element,
      visibility: element.style.visibility,
      pointerEvents: element.style.pointerEvents,
    };

    element.style.visibility = "hidden";
    element.style.pointerEvents = "none";

    return previous;
  });
}

function restoreHiddenDriveControls(hiddenControls: HiddenDriveControl[]) {
  hiddenControls.forEach(({ element, visibility, pointerEvents }) => {
    element.style.visibility = visibility;
    element.style.pointerEvents = pointerEvents;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);

  return x * x * (3 - 2 * x);
}

function hasRectChanged(
  current: ImageRect | null,
  next: ImageRect | null,
): boolean {
  if (!current || !next) return current !== next;

  const threshold = 0.25;

  return (
    Math.abs(current.left - next.left) > threshold ||
    Math.abs(current.top - next.top) > threshold ||
    Math.abs(current.width - next.width) > threshold ||
    Math.abs(current.height - next.height) > threshold
  );
}

function buildFilterValues(a: Adjustments): FilterValues {
  const temperature = a.temperature / 100;
  const tint = a.tint / 100;
  const exposure = a.exposure / 100;
  const contrast = a.contrast / 100;

  const redScale = clamp(1 + temperature * 0.32 + tint * 0.06, 0.55, 1.55);
  const greenScale = clamp(
    1 - Math.abs(temperature) * 0.04 - tint * 0.22,
    0.55,
    1.5,
  );
  const blueScale = clamp(1 - temperature * 0.4 + tint * 0.08, 0.5, 1.65);

  const exposureSlope = clamp(Math.pow(2, exposure * 0.72), 0.42, 2.4);
  const exposureIntercept = clamp((1 - exposureSlope) * 0.08, -0.08, 0.08);
  const contrastAmount = contrast * 0.36 + a.dehaze / 520;
  const shadowAmount = a.shadows / 100;
  const highlightAmount = a.highlights / 100;
  const whiteAmount = a.whites / 100;
  const blackAmount = a.blacks / 100;
  let previousTone = 0;
  const toneCurve = Array.from({ length: toneCurveSampleCount }, (_, index) => {
    const x = index / (toneCurveSampleCount - 1);
    const contrastWeight = 1 - Math.abs(x - 0.5) * 0.34;
    const shadowMask = 1 - smoothstep(0.08, 0.54, x);
    const highlightMask = smoothstep(0.46, 0.94, x);
    const blackMask = 1 - smoothstep(0, 0.28, x);
    const whiteMask = smoothstep(0.72, 1, x);
    let y = x;

    y = 0.5 + (y - 0.5) * (1 + contrastAmount * contrastWeight);
    y += shadowAmount * 0.18 * shadowMask * (1 - x * 0.45);
    y += highlightAmount * 0.18 * highlightMask * (0.35 + (1 - x) * 0.65);
    y += blackAmount * 0.12 * blackMask;
    y += whiteAmount * 0.12 * whiteMask;

    y = clamp(y, 0, 1);

    if (index > 0) {
      y = Math.max(y, previousTone + 0.002);
    }

    previousTone = clamp(y, 0, 1);

    return round(previousTone);
  })
    .join(" ");

  const saturation = clamp(
    1 + a.saturation / 120 + a.vibrance / 260 + a.dehaze / 480,
    0,
    2.4,
  );
  const detailAmount = clamp(
    (a.texture * 0.34 + a.clarity * 0.56 + a.dehaze * 0.28) / 100,
    -0.45,
    0.8,
  );

  return {
    whiteBalanceMatrix: [
      round(redScale),
      0,
      0,
      0,
      0,
      0,
      round(greenScale),
      0,
      0,
      0,
      0,
      0,
      round(blueScale),
      0,
      0,
      0,
      0,
      0,
      1,
      0,
    ].join(" "),
    exposureTone: {
      slope: round(exposureSlope),
      intercept: round(exposureIntercept),
    },
    toneCurve,
    saturation: round(saturation),
    detail: {
      amount: round(detailAmount),
      radius: detailAmount >= 0 ? 0.8 : 1.8,
    },
  };
}

function hasActiveAdjustments(adjustments: Adjustments): boolean {
  return Object.values(adjustments).some((value) => value !== 0);
}

function RetouchApp() {
  const [targetImage, setTargetImage] = useState<HTMLImageElement | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageRect, setImageRect] = useState<ImageRect | null>(null);
  const [retouchButtonPosition, setRetouchButtonPosition] =
    useState<RetouchButtonPosition | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [retouchZoom, setRetouchZoom] = useState(1);
  const [beforeAfter, setBeforeAfter] = useState(100);
  const [adjustments, setAdjustments] =
    useState<Adjustments>(defaultAdjustments);
  const targetImageRef = useRef<HTMLImageElement | null>(null);
  const imageSrcRef = useRef<string | null>(null);
  const imageRectRef = useRef<ImageRect | null>(null);
  const panelOpenRef = useRef(panelOpen);
  const scheduledFrameRef = useRef<number | null>(null);

  const filterValues = useMemo(
    () => buildFilterValues(adjustments),
    [adjustments],
  );
  const adjustmentsActive = useMemo(
    () => hasActiveAdjustments(adjustments),
    [adjustments],
  );
  const retouchRect = useMemo(() => {
    if (!imageRect) return null;

    const width = imageRect.width * retouchZoom;
    const height = imageRect.height * retouchZoom;

    return {
      left: imageRect.left + (imageRect.width - width) / 2,
      top: imageRect.top + (imageRect.height - height) / 2,
      width,
      height,
    };
  }, [imageRect, retouchZoom]);
  const retouchPreviewActive = adjustmentsActive || retouchZoom !== 1;

  useEffect(() => {
    panelOpenRef.current = panelOpen;
  }, [panelOpen]);

  const publishTarget = useCallback(
    (
      img: HTMLImageElement | null,
      src: string | null,
      rect: ImageRect | null,
    ) => {
      if (
        targetImageRef.current === img &&
        imageSrcRef.current === src &&
        !hasRectChanged(imageRectRef.current, rect)
      ) {
        return;
      }

      targetImageRef.current = img;
      imageSrcRef.current = src;
      imageRectRef.current = rect;
      setTargetImage(img);
      setImageSrc(src);
      setImageRect(rect);
    },
    [],
  );

  const updateTargetImage = useCallback(() => {
    const previewButtonPosition = getRetouchButtonPosition();

    if (!previewButtonPosition) {
      if (imageSrcRef.current && imageRectRef.current) {
        setPanelOpen(false);
        setRetouchZoom(1);
      }

      setRetouchButtonPosition(null);
      publishTarget(null, null, null);
      return;
    }

    const img = findLargestVisibleImage();

    if (!img) {
      if (imageSrcRef.current && imageRectRef.current) {
        return;
      }

      publishTarget(null, null, null);
      return;
    }

    publishTarget(img, img.currentSrc, getImageRect(img));
  }, [publishTarget]);

  const updateRetouchButtonPosition = useCallback(() => {
    const nextPosition = getRetouchButtonPosition();

    setRetouchButtonPosition((currentPosition) => {
      if (
        (!currentPosition && !nextPosition) ||
        (currentPosition &&
          nextPosition &&
          Math.abs(currentPosition.left - nextPosition.left) <= 0.25 &&
          Math.abs(currentPosition.top - nextPosition.top) <= 0.25)
      ) {
        return currentPosition;
      }

      return nextPosition;
    });
  }, []);

  const scheduleTargetUpdate = useCallback(() => {
    if (scheduledFrameRef.current !== null) return;

    scheduledFrameRef.current = window.requestAnimationFrame(() => {
      scheduledFrameRef.current = null;
      updateTargetImage();
      updateRetouchButtonPosition();
    });
  }, [updateTargetImage, updateRetouchButtonPosition]);

  useEffect(() => {
    updateTargetImage();
    updateRetouchButtonPosition();

    const observer = new MutationObserver(scheduleTargetUpdate);
    observer.observe(document.body ?? document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "style", "class"],
    });

    window.addEventListener("resize", scheduleTargetUpdate);
    window.addEventListener("scroll", scheduleTargetUpdate, true);

    const intervalId = window.setInterval(scheduleTargetUpdate, 500);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleTargetUpdate);
      window.removeEventListener("scroll", scheduleTargetUpdate, true);
      window.clearInterval(intervalId);

      if (scheduledFrameRef.current !== null) {
        window.cancelAnimationFrame(scheduledFrameRef.current);
      }
    };
  }, [scheduleTargetUpdate, updateTargetImage, updateRetouchButtonPosition]);

  useEffect(() => {
    if (!panelOpen) return;

    let animationFrameId = 0;

    const syncDuringPreviewChanges = () => {
      updateTargetImage();
      animationFrameId = window.requestAnimationFrame(syncDuringPreviewChanges);
    };

    animationFrameId = window.requestAnimationFrame(syncDuringPreviewChanges);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [panelOpen, updateTargetImage]);

  useEffect(() => {
    if (!panelOpen) return;

    let hiddenControls: HiddenDriveControl[] = [];

    const refreshHiddenControls = () => {
      restoreHiddenDriveControls(hiddenControls);
      hiddenControls = hideDriveZoomControls();
    };

    refreshHiddenControls();

    const observer = new MutationObserver(refreshHiddenControls);
    observer.observe(document.body ?? document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "aria-label",
        "title",
        "data-tooltip",
        "data-tooltip-text",
        "class",
      ],
    });

    return () => {
      observer.disconnect();
      restoreHiddenDriveControls(hiddenControls);
    };
  }, [panelOpen]);

  useEffect(() => {
    if (!targetImage) return;

    const previousFilter = targetImage.style.filter;
    const previousOpacity = targetImage.style.opacity;

    if (panelOpen && retouchPreviewActive) {
      // Google Drive側の元画像は加工せず、拡張側のプレビュー表示中だけ透明にする。
      // Before/Afterは同じ固定レイヤー内に重ね、ズーム時のズレを抑える。
      targetImage.style.filter = "";
      targetImage.style.opacity = "0";
    }

    return () => {
      targetImage.style.filter = previousFilter;
      targetImage.style.opacity = previousOpacity;
    };
  }, [panelOpen, retouchPreviewActive, targetImage]);

  const updateAdjustment = (key: keyof Adjustments, value: number) => {
    setAdjustments((prev) => ({
      ...prev,
      [key]: value,
    }));
  };
  const updateRetouchZoom = (nextZoom: number) => {
    setRetouchZoom(clamp(round(nextZoom), 0.25, 4));
  };
  const previewTargetPosition =
    imageSrc && imageRect ? retouchButtonPosition : null;

  return (
    <>
      {previewTargetPosition && !panelOpen && (
        <button
          className="dr-retouch-launcher"
          style={{
            left: previewTargetPosition.left,
            top: previewTargetPosition.top,
          }}
          title="Drive Retouchを開く"
          onClick={() => setPanelOpen(true)}
        >
          レタッチ
        </button>
      )}

      {panelOpen && imageSrc && retouchRect && (
        <>
          {retouchPreviewActive && (
            <>
              {adjustmentsActive && <RetouchFilter values={filterValues} />}

              <div
                className="dr-after-layer"
                style={{
                  left: retouchRect.left,
                  top: retouchRect.top,
                  width: retouchRect.width,
                  height: retouchRect.height,
                }}
              >
                <img
                  className="dr-before-image"
                  src={imageSrc}
                  style={{
                    width: retouchRect.width,
                    height: retouchRect.height,
                  }}
                />

                <div
                  className="dr-after-clip"
                  style={{
                    width: `${beforeAfter}%`,
                  }}
                >
                  <img
                    className="dr-after-image"
                    src={imageSrc}
                    style={{
                      width: retouchRect.width,
                      height: retouchRect.height,
                      filter: adjustmentsActive
                        ? `url(#${filterId})`
                        : undefined,
                    }}
                  />
                </div>

                <div
                  className="dr-before-after-line"
                  style={{
                    left: `${beforeAfter}%`,
                  }}
                />
              </div>
            </>
          )}

          <aside className="dr-control-panel">
            <header className="dr-panel-header">
              <div>
                <div className="dr-title">Drive Retouch</div>
                <div className="dr-subtitle">プレビューのみ / 保存されません</div>
              </div>

              <button
                className="dr-close"
                onClick={() => {
                  setPanelOpen(false);
                  setAdjustments(defaultAdjustments);
                  setBeforeAfter(100);
                  setRetouchZoom(1);
                }}
              >
                ×
              </button>
            </header>

            <Slider
              label="色温度"
              min={-100}
              max={100}
              value={adjustments.temperature}
              formatValue={(value) => `${Math.round(5_250 + value * 35)}`}
              onChange={(v) => updateAdjustment("temperature", v)}
            />

            <Slider
              label="色かぶり補正"
              min={-100}
              max={100}
              value={adjustments.tint}
              formatValue={(value) => (value > 0 ? `+${value}` : `${value}`)}
              onChange={(v) => updateAdjustment("tint", v)}
            />

            <div className="dr-divider-horizontal" />
            <div className="dr-section-title">階調</div>
            <Slider
              label="比較"
              min={0}
              max={100}
              value={beforeAfter}
              formatValue={(value) => `${value}%`}
              onChange={setBeforeAfter}
            />

            <div className="dr-zoom-label">拡大縮小</div>
            <div className="dr-zoom-controls" aria-label="レタッチ表示倍率">
              <button
                className="dr-zoom-button"
                type="button"
                onClick={() => updateRetouchZoom(retouchZoom - 0.25)}
              >
                −
              </button>
              <button
                className="dr-zoom-value"
                type="button"
                onClick={() => updateRetouchZoom(1)}
              >
                {Math.round(retouchZoom * 100)}%
              </button>
              <button
                className="dr-zoom-button"
                type="button"
                onClick={() => updateRetouchZoom(retouchZoom + 0.25)}
              >
                +
              </button>
            </div>

            <div className="dr-divider-horizontal" />

            <Slider
              label="露光量"
              min={-100}
              max={100}
              value={adjustments.exposure}
              formatValue={(value) => (value / 100).toFixed(2)}
              onChange={(v) => updateAdjustment("exposure", v)}
            />

            <Slider
              label="コントラスト"
              min={-100}
              max={100}
              value={adjustments.contrast}
              onChange={(v) => updateAdjustment("contrast", v)}
            />

            <Slider
              label="ハイライト"
              min={-100}
              max={100}
              value={adjustments.highlights}
              onChange={(v) => updateAdjustment("highlights", v)}
            />

            <Slider
              label="シャドウ"
              min={-100}
              max={100}
              value={adjustments.shadows}
              onChange={(v) => updateAdjustment("shadows", v)}
            />

            <Slider
              label="白レベル"
              min={-100}
              max={100}
              value={adjustments.whites}
              onChange={(v) => updateAdjustment("whites", v)}
            />

            <Slider
              label="黒レベル"
              min={-100}
              max={100}
              value={adjustments.blacks}
              onChange={(v) => updateAdjustment("blacks", v)}
            />

            <div className="dr-divider-horizontal" />
            <div className="dr-section-title">外観</div>
            <Slider
              label="テクスチャ"
              min={-100}
              max={100}
              value={adjustments.texture}
              onChange={(v) => updateAdjustment("texture", v)}
            />

            <Slider
              label="明瞭度"
              min={-100}
              max={100}
              value={adjustments.clarity}
              onChange={(v) => updateAdjustment("clarity", v)}
            />

            <Slider
              label="かすみの除去"
              min={-100}
              max={100}
              value={adjustments.dehaze}
              onChange={(v) => updateAdjustment("dehaze", v)}
            />

            <div className="dr-divider-horizontal" />
            <Slider
              label="自然な彩度"
              min={-100}
              max={100}
              value={adjustments.vibrance}
              onChange={(v) => updateAdjustment("vibrance", v)}
            />

            <Slider
              label="彩度"
              min={-100}
              max={100}
              value={adjustments.saturation}
              onChange={(v) => updateAdjustment("saturation", v)}
            />

            <button
              className="dr-reset"
              onClick={() => {
                setAdjustments(defaultAdjustments);
                setBeforeAfter(100);
                setRetouchZoom(1);
              }}
            >
              リセット
            </button>
          </aside>
        </>
      )}
    </>
  );
}

function RetouchFilter({ values }: { values: FilterValues }) {
  return (
    <svg className="dr-filter-defs" aria-hidden="true" focusable="false">
      <filter
        id={filterId}
        x="-12%"
        y="-12%"
        width="124%"
        height="124%"
        colorInterpolationFilters="sRGB"
      >
        <feColorMatrix
          in="SourceGraphic"
          type="matrix"
          values={values.whiteBalanceMatrix}
          result="whiteBalanced"
        />
        <feComponentTransfer in="whiteBalanced" result="exposureTone">
          <feFuncR
            type="linear"
            slope={values.exposureTone.slope}
            intercept={values.exposureTone.intercept}
          />
          <feFuncG
            type="linear"
            slope={values.exposureTone.slope}
            intercept={values.exposureTone.intercept}
          />
          <feFuncB
            type="linear"
            slope={values.exposureTone.slope}
            intercept={values.exposureTone.intercept}
          />
        </feComponentTransfer>
        <feComponentTransfer in="exposureTone" result="curveTone">
          <feFuncR
            type="table"
            tableValues={values.toneCurve}
          />
          <feFuncG
            type="table"
            tableValues={values.toneCurve}
          />
          <feFuncB
            type="table"
            tableValues={values.toneCurve}
          />
        </feComponentTransfer>
        <feColorMatrix
          in="curveTone"
          type="saturate"
          values={`${values.saturation}`}
          result="colorTone"
        />
        <feGaussianBlur
          in="colorTone"
          stdDeviation={values.detail.radius}
          result="softDetail"
        />
        <feComposite
          in="colorTone"
          in2="softDetail"
          operator="arithmetic"
          k2={1 + values.detail.amount}
          k3={-values.detail.amount}
        />
      </filter>
    </svg>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
  formatValue = (v) => `${v}`,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}) {
  return (
    <label className="dr-slider">
      <div className="dr-slider-row">
        <span>{label}</span>
        <span>{formatValue(value)}</span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
