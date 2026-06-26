import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./content.css";

type Adjustments = {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  saturation: number;
  warmth: number;
};

const defaultAdjustments: Adjustments = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  warmth: 0,
};

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

function buildFilter(a: Adjustments): string {
  const brightness = 1 + a.exposure / 100;
  const contrast = 1 + a.contrast / 100;
  const saturation = 1 + a.saturation / 100;

  // highlights / shadows はCSS filterだけだと本物のLightroomほど正確にはできないので近似
  const highlightContrast = 1 - Math.max(a.highlights, 0) / 300;
  const shadowBrightness = 1 + Math.max(a.shadows, 0) / 250;

  // warmth もCSSだけでは厳密ではないので、sepia + saturateで軽く近似
  const sepia = Math.max(a.warmth, 0) / 200;

  return [
    `brightness(${brightness * shadowBrightness})`,
    `contrast(${contrast * highlightContrast})`,
    `saturate(${saturation})`,
    `sepia(${sepia})`,
  ].join(" ");
}

function RetouchApp() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [beforeAfter, setBeforeAfter] = useState(50);
  const [adjustments, setAdjustments] =
    useState<Adjustments>(defaultAdjustments);

  const filter = useMemo(() => buildFilter(adjustments), [adjustments]);

  useEffect(() => {
    const updateTargetImage = () => {
      const img = findLargestVisibleImage();
      setImageSrc(img?.currentSrc ?? null);
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

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateTargetImage);
    };
  }, []);

  const updateAdjustment = (key: keyof Adjustments, value: number) => {
    setAdjustments((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  if (!imageSrc) {
    return null;
  }

  return (
    <>
      <button className="dr-floating-button" onClick={() => setOpen(true)}>
        Retouch
      </button>

      {open && (
        <div className="dr-overlay">
          <div className="dr-editor">
            <header className="dr-header">
              <div>
                <div className="dr-title">Drive Retouch</div>
                <div className="dr-subtitle">Preview only / not saved</div>
              </div>

              <button className="dr-close" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>

            <main className="dr-main">
              <section className="dr-preview">
                <div className="dr-image-stage">
                  <img className="dr-image dr-before" src={imageSrc} />

                  <div
                    className="dr-after-wrap"
                    style={{ width: `${beforeAfter}%` }}
                  >
                    <img
                      className="dr-image dr-after"
                      src={imageSrc}
                      style={{ filter }}
                    />
                  </div>

                  <div
                    className="dr-divider"
                    style={{ left: `${beforeAfter}%` }}
                  />
                </div>

                <label className="dr-before-after">
                  Before / After
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={beforeAfter}
                    onChange={(e) => setBeforeAfter(Number(e.target.value))}
                  />
                </label>
              </section>

              <aside className="dr-controls">
                <Slider
                  label="Exposure"
                  min={-100}
                  max={100}
                  value={adjustments.exposure}
                  onChange={(v) => updateAdjustment("exposure", v)}
                />

                <Slider
                  label="Contrast"
                  min={-100}
                  max={100}
                  value={adjustments.contrast}
                  onChange={(v) => updateAdjustment("contrast", v)}
                />

                <Slider
                  label="Highlights"
                  min={-100}
                  max={100}
                  value={adjustments.highlights}
                  onChange={(v) => updateAdjustment("highlights", v)}
                />

                <Slider
                  label="Shadows"
                  min={-100}
                  max={100}
                  value={adjustments.shadows}
                  onChange={(v) => updateAdjustment("shadows", v)}
                />

                <Slider
                  label="Saturation"
                  min={-100}
                  max={100}
                  value={adjustments.saturation}
                  onChange={(v) => updateAdjustment("saturation", v)}
                />

                <Slider
                  label="Warmth"
                  min={-100}
                  max={100}
                  value={adjustments.warmth}
                  onChange={(v) => updateAdjustment("warmth", v)}
                />

                <button
                  className="dr-reset"
                  onClick={() => setAdjustments(defaultAdjustments)}
                >
                  Reset
                </button>
              </aside>
            </main>
          </div>
        </div>
      )}
    </>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="dr-slider">
      <div className="dr-slider-row">
        <span>{label}</span>
        <span>{value}</span>
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

const root = document.createElement("div");
root.id = "drive-retouch-root";
document.documentElement.appendChild(root);

createRoot(root).render(<RetouchApp />);
