import { useEffect, useState } from 'react';
import { createProduct, updateProduct } from '../lib/db/products';
import { uploadProductImageSets, deleteProductImageSet, validateImageFile } from '../lib/djangoStorage';
import { getThumbUrl } from '../lib/images';
import { subscribeCategories } from '../lib/db/categories';

const STANDARD_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

// Files don't have a stable id of their own — this composite key is
// stable across re-renders for the *same* picked file, which is what we
// need to track per-file upload progress in a plain object.
const fileKey = (file) => `${file.name}-${file.size}-${file.lastModified}`;

// ISO string from the API -> value a <input type="datetime-local"> accepts.
const toLocalInputValue = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// <input type="datetime-local"> value -> ISO string (or null) for the API.
const fromLocalInputValue = (value) => (value ? new Date(value).toISOString() : null);

const emptyForm = {
  name: '',
  tag: '',
  category: '',
  price: '',
  discountType: 'percentage',
  discountValue: '',
  discountStart: '',
  discountEnd: '',
  stock: '',
  colors: '',
  sizes: [],
  description: '',
  details: '',
  visible: true,
};

export default function ProductForm({ product, onClose }) {
  const [form, setForm] = useState(emptyForm);
  const [images, setImages] = useState([]); // existing, already-uploaded URLs
  const [newFiles, setNewFiles] = useState([]); // File objects pending upload
  const [fileError, setFileError] = useState(''); // rejected-at-selection message
  const [uploadErrors, setUploadErrors] = useState([]); // [{name, error}] from last save attempt
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [progressMap, setProgressMap] = useState({}); // fileKey -> 0..1
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState(product?.id || null);

  useEffect(() => subscribeCategories(setCategories), []);

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name || '',
        tag: product.tag || '',
        category: product.category || '',
        price: product.originalPrice ?? product.price ?? '',
        discountType: product.discount_type || 'percentage',
        discountValue: product.discount_value || '',
        discountStart: toLocalInputValue(product.discount_start),
        discountEnd: toLocalInputValue(product.discount_end),
        stock: product.stock ?? '',
        colors: (product.colors || []).join(', '),
        sizes: product.sizes || [],
        description: product.description || '',
        details: (product.details || []).join('\n'),
        visible: product.visible !== false,
      });
      setImages(product.images || []);
      setSavedId(product.id);
    }
  }, [product]);

  const toggleSize = (s) => {
    setForm((f) => ({
      ...f,
      sizes: f.sizes.includes(s) ? f.sizes.filter((x) => x !== s) : [...f.sizes, s],
    }));
  };

  const removeExistingImage = async (image) => {
    setImages((imgs) => imgs.filter((img) => img !== image));
    deleteProductImageSet(image);
  };

  const handleFilePick = (fileList) => {
    const picked = Array.from(fileList);
    const valid = [];
    const rejections = [];
    for (const file of picked) {
      const reason = validateImageFile(file);
      if (reason) rejections.push(reason);
      else valid.push(file);
    }
    setFileError(rejections.join(' '));
    if (valid.length > 0) {
      setNewFiles((fs) => [...fs, ...valid]);
      setUploadErrors((errs) => errs.filter((e) => !valid.some((v) => v.name === e.name)));
    }
  };

  const buildPayload = () => ({
    name: form.name.trim(),
    tag: form.tag.trim(),
    category: form.category,
    price: Number(form.price) || 0,
    discount_type: form.discountType,
    discount_value: Number(form.discountValue) || 0,
    discount_start: fromLocalInputValue(form.discountStart),
    discount_end: fromLocalInputValue(form.discountEnd),
    stock: Number(form.stock) || 0,
    colors: form.colors
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
    sizes: form.sizes,
    description: form.description.trim(),
    details: form.details.split('\n').map((d) => d.trim()).filter(Boolean),
    visible: form.visible,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Product name is required.');
      return;
    }
    setError('');
    setUploadErrors([]);
    setSaving(true);

    // Save the product's text/number fields FIRST, independent of image
    // upload success — so a flaky network never loses the rest of the
    // form. Every path below (success or partial failure) always leaves
    // the product record correctly saved.
    let id = savedId;
    try {
      const payload = buildPayload();
      if (id) {
        await updateProduct(id, { ...payload, images });
      } else {
        id = await createProduct({ ...payload, images });
        setSavedId(id);
      }
    } catch (err) {
      setError(err?.message || 'Failed to save product details.');
      setSaving(false);
      return;
    }

    // Now optimize (resize + WebP encode) and upload any newly-picked
    // images — each one isolated, so one bad file/network hiccup never
    // blocks the others or leaves the button stuck on "Saving…" forever.
    if (newFiles.length > 0) {
      setUploadingCount(newFiles.length);
      const { succeeded, failed } = await uploadProductImageSets(
        id,
        newFiles,
        (file, p) => setProgressMap((m) => ({ ...m, [fileKey(file)]: p }))
      );
      setUploadingCount(0);

      if (succeeded.length > 0) {
        const finalImages = [
          ...images,
          ...succeeded
            .filter((s) => s.large && s.thumb) // never save a partial/undefined image entry
            .map((s) => ({ large: s.large, thumb: s.thumb })),
        ];
        try {
          await updateProduct(id, { images: finalImages });
          setImages(finalImages);
          setNewFiles((fs) => fs.filter((f) => !succeeded.some((s) => s.file === f)));
          setProgressMap((m) => {
            const next = { ...m };
            succeeded.forEach((s) => delete next[fileKey(s.file)]);
            return next;
          });
        } catch (err) {
          setError(err?.message || 'Images uploaded but failed to save to the product.');
        }
      }

      if (failed.length > 0) {
        setUploadErrors(failed.map((f) => ({ name: f.file.name, error: f.error })));
        setNewFiles(failed.map((f) => f.file));
        setSaving(false);
        return; // keep the form open so they can see/retry the failed ones
      }
    }

    setSaving(false);
    onClose();
  };

  const busy = saving || uploadingCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            {product ? 'Edit Product' : 'Add Product'}
          </h2>
          <button onClick={onClose} className="text-black/40 hover:text-black">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="input"
            />
          </Field>

          <Field label="Tag / subtitle">
            <input
              value={form.tag}
              onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
              className="input"
            />
          </Field>

          <Field label="Category">
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="input"
            >
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (EGP)">
              <input
                type="number"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                className="input"
              />
            </Field>
            <Field label="Stock">
              <input
                type="number"
                value={form.stock}
                onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
                className="input"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount type">
              <select
                value={form.discountType}
                onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value }))}
                className="input"
              >
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed amount (EGP)</option>
              </select>
            </Field>
            <Field label={form.discountType === 'fixed' ? 'Discount (EGP)' : 'Discount (%)'}>
              <input
                type="number"
                value={form.discountValue}
                onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
                className="input"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount starts (optional)">
              <input
                type="datetime-local"
                value={form.discountStart}
                onChange={(e) => setForm((f) => ({ ...f, discountStart: e.target.value }))}
                className="input"
              />
            </Field>
            <Field label="Discount ends (optional)">
              <input
                type="datetime-local"
                value={form.discountEnd}
                onChange={(e) => setForm((f) => ({ ...f, discountEnd: e.target.value }))}
                className="input"
              />
            </Field>
          </div>
          <p className="eyebrow text-gray-mid">
            Leave both dates blank for an always-on discount while the value above is greater than 0.
          </p>

          <Field label="Colors (comma-separated)">
            <input
              value={form.colors}
              onChange={(e) => setForm((f) => ({ ...f, colors: e.target.value }))}
              placeholder="Jet Black, Off White, Electric Blue"
              className="input"
            />
          </Field>

          <Field label="Sizes">
            <div className="flex flex-wrap gap-2">
              {STANDARD_SIZES.map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => toggleSize(s)}
                  className={`h-9 w-9 rounded-md border text-xs font-medium ${
                    form.sizes.includes(s)
                      ? 'border-black bg-black text-white'
                      : 'border-black/15 text-black/60 hover:border-black/40'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              className="input resize-none"
            />
          </Field>

          <Field label="Details (one per line)">
            <textarea
              value={form.details}
              onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))}
              rows={3}
              className="input resize-none"
            />
          </Field>

          <Field label="Images">
            <div className="flex flex-wrap gap-3">
              {images.map((image, idx) => {
                const previewUrl = getThumbUrl(image);
                return (
                  <div
                    key={previewUrl || idx}
                    className="relative h-20 w-16 overflow-hidden rounded border border-black/10 bg-black/5"
                  >
                    {previewUrl && (
                      <img
                        src={previewUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeExistingImage(image)}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              {newFiles.map((file, i) => {
                const failedInfo = uploadErrors.find((e) => e.name === file.name);
                const progress = progressMap[fileKey(file)] ?? 0;
                return (
                  <div
                    key={i}
                    className={`relative h-20 w-16 overflow-hidden rounded border ${
                      failedInfo ? 'border-red-400' : 'border-black/10'
                    }`}
                    title={failedInfo?.error || ''}
                  >
                    <img
                      src={URL.createObjectURL(file)}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                    {uploadingCount > 0 && !failedInfo && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                        <span className="font-mono text-[10px] font-medium text-black/70">
                          {Math.round(progress * 100)}%
                        </span>
                      </div>
                    )}
                    {failedInfo && (
                      <div className="absolute inset-x-0 bottom-0 bg-red-500/90 px-1 py-0.5 text-center text-[9px] leading-tight text-white">
                        Failed
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setNewFiles((fs) => fs.filter((_, idx) => idx !== i));
                        setUploadErrors((errs) => errs.filter((e) => e.name !== file.name));
                      }}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <label className="flex h-20 w-16 cursor-pointer items-center justify-center rounded border border-dashed border-black/25 text-xs text-black/40 hover:border-black/50">
                +
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    handleFilePick(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {fileError && <p className="mt-2 text-xs text-red-600">{fileError}</p>}
            {uploadErrors.length > 0 && (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {uploadErrors.map((e, i) => (
                  <p key={i} className={i > 0 ? 'mt-1' : ''}>
                    <span className="font-medium">{e.name}:</span> {e.error}
                  </p>
                ))}
                <p className="mt-1 text-red-600/70">
                  The rest of the product was saved — just retry these images (✕ to remove, or press
                  Save again to retry).
                </p>
              </div>
            )}
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.visible}
              onChange={(e) => setForm((f) => ({ ...f, visible: e.target.checked }))}
            />
            Visible on storefront
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-black py-3 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {uploadingCount > 0
              ? `Uploading ${uploadingCount} image${uploadingCount > 1 ? 's' : ''}…`
              : saving
              ? 'Saving…'
              : product
              ? 'Save Changes'
              : 'Create Product'}
          </button>
        </form>
      </div>

      <style>{`.input { width: 100%; border: 1px solid rgba(0,0,0,0.15); border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.875rem; outline: none; } .input:focus { border-color: black; }`}</style>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-black/40">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
