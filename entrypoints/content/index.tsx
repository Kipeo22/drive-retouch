import { useEffect, useMemo, useState } from "react";
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

type FilterValues = {
  whiteBalanceMatrix: string;
  linearTone: {
    slope: number;
    intercept: number;
  };
  curveTone: {
    amplitude: number;
    exponent: number;
    offset: number;
  };
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

export default defineContentScript({
  matches: ["https://drive.google.com/*"],
  main() {
    const existingRoot = document.getElementById("drive-retouch-root");
    if (existingRoot) return;

    const root = document.createElement("div");
    root.id = "drive-retouch-root";
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
  return Number(value.toFixed(4));
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

  const contrastSlope = 1 + contrast * 0.72 + a.dehaze / 360;
  const exposureSlope = Math.pow(2, exposure);
  const linearSlope = clamp(
    exposureSlope * contrastSlope * (1 + a.whites / 320),
    0.16,
    3.4,
  );
  const linearIntercept = clamp(
    0.5 * (1 - contrastSlope) + a.blacks / 420 + a.shadows / 900,
    -0.65,
    0.65,
  );

  const curveExponent = clamp(
    1 - a.shadows / 240 + Math.max(-a.highlights, 0) / 280,
    0.35,
    2.8,
  );
  const curveAmplitude = clamp(
    1 + a.highlights / 260 + a.whites / 650,
    0.32,
    2.1,
  );
  const curveOffset = clamp(a.blacks / 700, -0.28, 0.28);

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
    linearTone: {
      slope: round(linearSlope),
      intercept: round(linearIntercept),
    },
    curveTone: {
      amplitude: round(curveAmplitude),
      exponent: round(curveExponent),
      offset: round(curveOffset),
    },
    saturation: round(saturation),
    detail: {
      amount: round(detailAmount),
      radius: detailAmount >= 0 ? 0.8 : 1.8,
    },
  };
}

function RetouchApp() {
  const [targetImage, setTargetImage] = useState<HTMLImageElement | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageRect, setImageRect] = useState<ImageRect | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [beforeAfter, setBeforeAfter] = useState(100);
  const [adjustments, setAdjustments] =
    useState<Adjustments>(defaultAdjustments);

  const filterValues = useMemo(
    () => buildFilterValues(adjustments),
    [adjustments],
  );

  useEffect(() => {
    const updateTargetImage = () => {
      const img = findLargestVisibleImage();

      setTargetImage(img);
      setImageSrc(img?.currentSrc ?? null);
      setImageRect(img ? getImageRect(img) : null);
    };

    updateTargetImage();

    const observer = new MutationObserver(updateTargetImage);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "style", "class"],
    });

    window.addEventListener("resize", updateTargetImage);
    window.addEventListener("scroll", updateTargetImage, true);

    const intervalId = window.setInterval(updateTargetImage, 500);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateTargetImage);
      window.removeEventListener("scroll", updateTargetImage, true);
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!targetImage) return;

    // Google Drive側の元画像は加工しない。
    // Beforeとして残して、その上にAfter画像を重ねる。
    targetImage.style.filter = "";

    return () => {
      targetImage.style.filter = "";
    };
  }, [targetImage]);

  const updateAdjustment = (key: keyof Adjustments, value: number) => {
    setAdjustments((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  if (!imageSrc || !imageRect) {
    return null;
  }

  return (
    <>
      {!panelOpen && (
        <button
          className="dr-floating-button"
          onClick={() => setPanelOpen(true)}
        >
          レタッチ
        </button>
      )}

      {panelOpen && (
        <>
          <RetouchFilter values={filterValues} />

          <div
            className="dr-after-layer"
            style={{
              left: imageRect.left,
              top: imageRect.top,
              width: imageRect.width,
              height: imageRect.height,
            }}
          >
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
                  width: imageRect.width,
                  height: imageRect.height,
                  filter: `url(#${filterId})`,
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
        <feComponentTransfer in="whiteBalanced" result="linearTone">
          <feFuncR
            type="linear"
            slope={values.linearTone.slope}
            intercept={values.linearTone.intercept}
          />
          <feFuncG
            type="linear"
            slope={values.linearTone.slope}
            intercept={values.linearTone.intercept}
          />
          <feFuncB
            type="linear"
            slope={values.linearTone.slope}
            intercept={values.linearTone.intercept}
          />
        </feComponentTransfer>
        <feComponentTransfer in="linearTone" result="curveTone">
          <feFuncR
            type="gamma"
            amplitude={values.curveTone.amplitude}
            exponent={values.curveTone.exponent}
            offset={values.curveTone.offset}
          />
          <feFuncG
            type="gamma"
            amplitude={values.curveTone.amplitude}
            exponent={values.curveTone.exponent}
            offset={values.curveTone.offset}
          />
          <feFuncB
            type="gamma"
            amplitude={values.curveTone.amplitude}
            exponent={values.curveTone.exponent}
            offset={values.curveTone.offset}
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
