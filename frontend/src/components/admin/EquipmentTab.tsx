import { useCallback, useEffect, useState } from "react";
import {
  createCategory,
  createItem,
  createModel,
  deleteCategory,
  deleteItem,
  deleteModel,
  fetchAdminCategories,
  fetchAdminItems,
  fetchAdminModels,
  updateCategory,
  updateItem,
  updateModel,
  type AccessPolicy,
  type CategoryAdmin,
  type ItemAdmin,
  type ItemStatus,
  type ModelAdmin,
  type TrackingType,
} from "../../api/admin";
import { ApiError } from "../../api/client";
import { Modal } from "../Modal";
import { ConfirmModal } from "../ConfirmModal";
import { useToast } from "../Toast";

type EqTab = "categories" | "models" | "items";

// ---------- Category form ----------
type CategoryDraft = {
  id: number | null;
  code: string;
  name: string;
  description: string;
};


export function EquipmentTab() {
  const toast = useToast();
  const setError = (msg: string | null) => {
    if (msg) toast.error(msg);
  };
  const [eqTab, setEqTab] = useState<EqTab>("categories");
  const [busy, setBusy] = useState(false);

  const [categories, setCategories] = useState<CategoryAdmin[] | null>(null);
  const [models, setModels] = useState<ModelAdmin[] | null>(null);
  const [items, setItems] = useState<ItemAdmin[] | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await fetchAdminCategories());
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Ошибка категорий");
    }
  }, []);
  const loadModels = useCallback(async () => {
    try {
      setModels(await fetchAdminModels());
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Ошибка моделей");
    }
  }, []);
  const loadItems = useCallback(async () => {
    try {
      setItems(await fetchAdminItems());
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Ошибка экземпляров");
    }
  }, []);

  useEffect(() => {
    if (eqTab === "categories" && categories === null) void loadCategories();
    if (eqTab === "models" && models === null) void loadModels();
    if (eqTab === "items" && items === null) void loadItems();
  }, [eqTab, categories, models, items, loadCategories, loadModels, loadItems]);

  return (
    <div className="equipment-admin">
      <div className="segmented" role="tablist">
        <button type="button" role="tab"
          aria-selected={eqTab === "categories"}
          className={`segmented__item${eqTab === "categories" ? " is-active" : ""}`}
          onClick={() => setEqTab("categories")}>Категории</button>
        <button type="button" role="tab"
          aria-selected={eqTab === "models"}
          className={`segmented__item${eqTab === "models" ? " is-active" : ""}`}
          onClick={() => setEqTab("models")}>Модели</button>
        <button type="button" role="tab"
          aria-selected={eqTab === "items"}
          className={`segmented__item${eqTab === "items" ? " is-active" : ""}`}
          onClick={() => setEqTab("items")}>Экземпляры</button>
      </div>

      {/* ================= CATEGORIES ================= */}
      {eqTab === "categories" && (
        <CategoriesSection
          categories={categories}
          reload={loadCategories}
          setError={setError}
          busy={busy}
          setBusy={setBusy}
        />
      )}

      {/* ================= MODELS ================= */}
      {eqTab === "models" && (
        <ModelsSection
          categories={categories ?? []}
          models={models}
          reload={loadModels}
          reloadCategories={loadCategories}
          setError={setError}
          busy={busy}
          setBusy={setBusy}
        />
      )}

      {/* ================= ITEMS ================= */}
      {eqTab === "items" && (
        <ItemsSection
          models={models ?? []}
          items={items}
          reload={loadItems}
          reloadModels={loadModels}
          setError={setError}
          busy={busy}
          setBusy={setBusy}
        />
      )}
    </div>
  );
}

// ============================================================
// Categories section (with modal)
// ============================================================
function CategoriesSection({
  categories,
  reload,
  setError,
  busy,
  setBusy,
}: {
  categories: CategoryAdmin[] | null;
  reload: () => Promise<void>;
  setError: (s: string | null) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CategoryAdmin | null>(null);

  const openCreate = () =>
    setDraft({ id: null, code: "", name: "", description: "" });
  const openEdit = (c: CategoryAdmin) =>
    setDraft({
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description ?? "",
    });

  const submit = async (d: CategoryDraft) => {
    setBusy(true);
    setError(null);
    try {
      if (d.id === null) {
        await createCategory({
          code: d.code,
          name: d.name,
          description: d.description || null,
        });
      } else {
        await updateCategory(d.id, {
          name: d.name,
          description: d.description || null,
        });
      }
      setDraft(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCategory(confirmDelete.id);
      setConfirmDelete(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка удаления");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="list">
      <div className="row-actions" style={{ marginBottom: 8 }}>
        <button type="button" className="card__cta" onClick={openCreate}>
          + Категория
        </button>
      </div>
      {categories === null && <p className="empty__text">Загрузка…</p>}
      {categories?.map((c) => (
        <div className="card" key={c.id}>
          <div className="card__heading">
            <h3 className="card__title">{c.name}</h3>
            <code className="card__code">{c.code}</code>
          </div>
          {c.description && (
            <p className="card__subtitle">{c.description}</p>
          )}
          <div className="row-actions">
            <button
              type="button"
              className="card__cta card__cta--secondary"
              onClick={() => openEdit(c)}
            >
              Изменить
            </button>
            <button
              type="button"
              className="card__cta card__cta--danger"
              onClick={() => setConfirmDelete(c)}
            >
              Удалить
            </button>
          </div>
        </div>
      ))}

      <CategoryModal2
        open={draft !== null}
        draft={draft}
        busy={busy}
        onClose={() => setDraft(null)}
        onSubmit={submit}
      />

      <ConfirmModal
        open={confirmDelete !== null}
        title="Удалить категорию?"
        message={`Удалить категорию «${confirmDelete?.name ?? ""}»?`}
        confirmLabel="Удалить"
        danger
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

// Правильная (управляемая) модалка категории
function CategoryModal2({
  open,
  draft,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  draft: CategoryDraft | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (d: CategoryDraft) => void;
}) {
  const [local, setLocal] = useState<CategoryDraft | null>(draft);
  useEffect(() => setLocal(draft), [draft]);
  const isEdit = local?.id !== null && local !== null;

  if (!local) return null;

  return (
    <Modal
      open={open}
      title={isEdit ? "Редактировать категорию" : "Новая категория"}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="card__cta card__cta--secondary"
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="button"
            className="card__cta"
            disabled={busy || !local.code.trim() || !local.name.trim()}
            onClick={() => onSubmit(local)}
          >
            Сохранить
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">Код (slug, латиница)</span>
        <input
          type="text"
          value={local.code}
          disabled={!!isEdit}
          onChange={(e) =>
            setLocal({ ...local, code: e.target.value })
          }
        />
      </label>
      <label className="field">
        <span className="field__label">Название</span>
        <input
          type="text"
          value={local.name}
          onChange={(e) => setLocal({ ...local, name: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">Описание</span>
        <textarea
          rows={2}
          value={local.description}
          onChange={(e) =>
            setLocal({ ...local, description: e.target.value })
          }
        />
      </label>
    </Modal>
  );
}

// ============================================================
// Models section
// ============================================================
type ModelDraft = {
  id: number | null;
  category_id: number;
  name: string;
  manufacturer: string;
  description: string;
  access_policy: AccessPolicy;
  tracking_type: TrackingType;
  total_quantity: number;
};

const emptyModel = (catId: number): ModelDraft => ({
  id: null,
  category_id: catId,
  name: "",
  manufacturer: "",
  description: "",
  access_policy: "all",
  tracking_type: "quantity",
  total_quantity: 1,
});

function ModelsSection({
  categories,
  models,
  reload,
  reloadCategories,
  setError,
  busy,
  setBusy,
}: {
  categories: CategoryAdmin[];
  models: ModelAdmin[] | null;
  reload: () => Promise<void>;
  reloadCategories: () => Promise<void>;
  setError: (s: string | null) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const [draft, setDraft] = useState<ModelDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ModelAdmin | null>(null);
  const [filterCatId, setFilterCatId] = useState<number | null>(null);

  useEffect(() => {
    if (categories.length === 0) void reloadCategories();
  }, [categories.length, reloadCategories]);

  const filtered =
    filterCatId === null
      ? models
      : models?.filter((m) => m.category_id === filterCatId);

  const openCreate = () => {
    if (categories.length === 0) {
      setError("Сначала создайте категорию");
      return;
    }
    setDraft(emptyModel(categories[0].id));
  };
  const openEdit = (m: ModelAdmin) =>
    setDraft({
      id: m.id,
      category_id: m.category_id,
      name: m.name,
      manufacturer: m.manufacturer ?? "",
      description: m.description ?? "",
      access_policy: m.access_policy,
      tracking_type: m.tracking_type,
      total_quantity: m.total_quantity,
    });

  const submit = async (d: ModelDraft) => {
    setBusy(true);
    setError(null);
    try {
      if (d.id === null) {
        await createModel({
          category_id: d.category_id,
          name: d.name,
          manufacturer: d.manufacturer || null,
          description: d.description || null,
          access_policy: d.access_policy,
          tracking_type: d.tracking_type,
          total_quantity: d.total_quantity,
        });
      } else {
        await updateModel(d.id, {
          category_id: d.category_id,
          name: d.name,
          manufacturer: d.manufacturer || null,
          description: d.description || null,
          access_policy: d.access_policy,
          tracking_type: d.tracking_type,
          total_quantity: d.total_quantity,
        });
      }
      setDraft(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    setError(null);
    try {
      await deleteModel(confirmDelete.id);
      setConfirmDelete(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка удаления");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="list">
      <div className="eq-filter">
        <label>
          Категория:{" "}
          <select
            value={filterCatId ?? ""}
            onChange={(e) =>
              setFilterCatId(e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">Все</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row-actions" style={{ marginBottom: 8 }}>
        <button type="button" className="card__cta" onClick={openCreate}>
          + Модель
        </button>
      </div>

      {models === null && <p className="empty__text">Загрузка…</p>}
      {filtered?.length === 0 && (
        <p className="empty__text">Модели отсутствуют.</p>
      )}
      {filtered?.map((m) => {
        const cat = categories.find((c) => c.id === m.category_id);
        return (
          <div className="card" key={m.id}>
            <div className="card__heading">
              <h3 className="card__title">{m.name}</h3>
              <code className="card__code">
                {m.access_policy} · {m.tracking_type} · qty={m.total_quantity}
              </code>
            </div>
            <p className="card__subtitle">
              {cat?.name ?? `cat#${m.category_id}`}
              {m.manufacturer ? ` · ${m.manufacturer}` : ""}
            </p>
            {m.description && (
              <p className="card__subtitle">{m.description}</p>
            )}
            <div className="row-actions">
              <button
                type="button"
                className="card__cta card__cta--secondary"
                onClick={() => openEdit(m)}
              >
                Изменить
              </button>
              <button
                type="button"
                className="card__cta card__cta--danger"
                onClick={() => setConfirmDelete(m)}
              >
                Удалить
              </button>
            </div>
          </div>
        );
      })}

      <ModelModal2
        open={draft !== null}
        draft={draft}
        categories={categories}
        busy={busy}
        onClose={() => setDraft(null)}
        onSubmit={submit}
      />

      <ConfirmModal
        open={confirmDelete !== null}
        title="Удалить модель?"
        message={`Удалить модель «${confirmDelete?.name ?? ""}»?`}
        confirmLabel="Удалить"
        danger
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function ModelModal2({
  open,
  draft,
  categories,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  draft: ModelDraft | null;
  categories: CategoryAdmin[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (d: ModelDraft) => void;
}) {
  const [local, setLocal] = useState<ModelDraft | null>(draft);
  useEffect(() => setLocal(draft), [draft]);
  const isEdit = local?.id !== null && local !== null;
  if (!local) return null;

  return (
    <Modal
      open={open}
      title={isEdit ? "Редактировать модель" : "Новая модель"}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button
            type="button"
            className="card__cta card__cta--secondary"
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="button"
            className="card__cta"
            disabled={busy || !local.name.trim()}
            onClick={() => onSubmit(local)}
          >
            Сохранить
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">Категория</span>
        <select
          value={local.category_id}
          onChange={(e) =>
            setLocal({ ...local, category_id: Number(e.target.value) })
          }
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">Название</span>
        <input
          type="text"
          value={local.name}
          onChange={(e) => setLocal({ ...local, name: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">Производитель</span>
        <input
          type="text"
          value={local.manufacturer}
          onChange={(e) => setLocal({ ...local, manufacturer: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">Описание</span>
        <textarea
          rows={2}
          value={local.description}
          onChange={(e) => setLocal({ ...local, description: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">Политика доступа</span>
        <select
          value={local.access_policy}
          onChange={(e) =>
            setLocal({ ...local, access_policy: e.target.value as AccessPolicy })
          }
        >
          <option value="all">Все</option>
          <option value="videographer">МИЭТ-ТВ (видеографы)</option>
          <option value="photographer">InFocus (фотографы)</option>
        </select>
      </label>
      <label className="field">
        <span className="field__label">Тип учёта</span>
        <select
          value={local.tracking_type}
          onChange={(e) =>
            setLocal({
              ...local,
              tracking_type: e.target.value as TrackingType,
            })
          }
        >
          <option value="quantity">Количественный</option>
          <option value="individual">По экземплярам</option>
        </select>
      </label>
      <label className="field">
        <span className="field__label">Общее количество</span>
        <input
          type="number"
          min={0}
          value={local.total_quantity}
          onChange={(e) =>
            setLocal({ ...local, total_quantity: Number(e.target.value) })
          }
        />
      </label>
    </Modal>
  );
}

// ============================================================
// Items section
// ============================================================
type ItemDraft = {
  id: number | null;
  model_id: number;
  inventory_number: string;
  serial_number: string;
  status: ItemStatus;
  notes: string;
};

const emptyItem = (modelId: number): ItemDraft => ({
  id: null,
  model_id: modelId,
  inventory_number: "",
  serial_number: "",
  status: "active",
  notes: "",
});

function ItemsSection({
  models,
  items,
  reload,
  reloadModels,
  setError,
  busy,
  setBusy,
}: {
  models: ModelAdmin[];
  items: ItemAdmin[] | null;
  reload: () => Promise<void>;
  reloadModels: () => Promise<void>;
  setError: (s: string | null) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ItemAdmin | null>(null);
  const [filterModelId, setFilterModelId] = useState<number | null>(null);

  useEffect(() => {
    if (models.length === 0) void reloadModels();
  }, [models.length, reloadModels]);

  const filtered =
    filterModelId === null
      ? items
      : items?.filter((it) => it.model_id === filterModelId);

  const openCreate = () => {
    if (models.length === 0) {
      setError("Сначала создайте модель");
      return;
    }
    setDraft(emptyItem(models[0].id));
  };
  const openEdit = (it: ItemAdmin) =>
    setDraft({
      id: it.id,
      model_id: it.model_id,
      inventory_number: it.inventory_number,
      serial_number: it.serial_number ?? "",
      status: it.status,
      notes: it.notes ?? "",
    });

  const submit = async (d: ItemDraft) => {
    setBusy(true);
    setError(null);
    try {
      if (d.id === null) {
        await createItem({
          model_id: d.model_id,
          inventory_number: d.inventory_number,
          serial_number: d.serial_number || null,
          status: d.status,
          notes: d.notes || null,
        });
      } else {
        await updateItem(d.id, {
          serial_number: d.serial_number || null,
          status: d.status,
          notes: d.notes || null,
        });
      }
      setDraft(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    setError(null);
    try {
      await deleteItem(confirmDelete.id);
      setConfirmDelete(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка удаления");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="list">
      <div className="eq-filter">
        <label>
          Модель:{" "}
          <select
            value={filterModelId ?? ""}
            onChange={(e) =>
              setFilterModelId(e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">Все</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row-actions" style={{ marginBottom: 8 }}>
        <button type="button" className="card__cta" onClick={openCreate}>
          + Экземпляр
        </button>
      </div>

      {items === null && <p className="empty__text">Загрузка…</p>}
      {filtered?.length === 0 && (
        <p className="empty__text">Экземпляры отсутствуют.</p>
      )}
      {filtered?.map((it) => {
        const model = models.find((m) => m.id === it.model_id);
        return (
          <div className="card" key={it.id}>
            <div className="card__heading">
              <h3 className="card__title">{it.inventory_number}</h3>
              <span
                className={`status-chip${
                  it.status === "active"
                    ? " status-chip--success"
                    : it.status === "maintenance"
                    ? " status-chip--warning"
                    : " status-chip--error"
                }`}
              >
                {it.status}
              </span>
            </div>
            <p className="card__subtitle">
              {model?.name ?? `model#${it.model_id}`}
              {it.serial_number ? ` · S/N ${it.serial_number}` : ""}
            </p>
            {it.notes && <p className="card__subtitle">{it.notes}</p>}
            <div className="row-actions">
              <button
                type="button"
                className="card__cta card__cta--secondary"
                onClick={() => openEdit(it)}
              >
                Изменить
              </button>
              <button
                type="button"
                className="card__cta card__cta--danger"
                onClick={() => setConfirmDelete(it)}
              >
                Удалить
              </button>
            </div>
          </div>
        );
      })}

      <ItemModal2
        open={draft !== null}
        draft={draft}
        models={models}
        busy={busy}
        onClose={() => setDraft(null)}
        onSubmit={submit}
      />

      <ConfirmModal
        open={confirmDelete !== null}
        title="Удалить экземпляр?"
        message={`Удалить экземпляр «${confirmDelete?.inventory_number ?? ""}»?`}
        confirmLabel="Удалить"
        danger
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function ItemModal2({
  open,
  draft,
  models,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  draft: ItemDraft | null;
  models: ModelAdmin[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (d: ItemDraft) => void;
}) {
  const [local, setLocal] = useState<ItemDraft | null>(draft);
  useEffect(() => setLocal(draft), [draft]);
  const isEdit = local?.id !== null && local !== null;
  if (!local) return null;

  return (
    <Modal
      open={open}
      title={isEdit ? "Редактировать экземпляр" : "Новый экземпляр"}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="card__cta card__cta--secondary"
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="button"
            className="card__cta"
            disabled={busy || !local.inventory_number.trim()}
            onClick={() => onSubmit(local)}
          >
            Сохранить
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">Модель</span>
        <select
          value={local.model_id}
          disabled={!!isEdit}
          onChange={(e) =>
            setLocal({ ...local, model_id: Number(e.target.value) })
          }
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">Инвентарный номер</span>
        <input
          type="text"
          value={local.inventory_number}
          disabled={!!isEdit}
          onChange={(e) =>
            setLocal({ ...local, inventory_number: e.target.value })
          }
        />
      </label>
      <label className="field">
        <span className="field__label">Серийный номер</span>
        <input
          type="text"
          value={local.serial_number}
          onChange={(e) =>
            setLocal({ ...local, serial_number: e.target.value })
          }
        />
      </label>
      <label className="field">
        <span className="field__label">Статус</span>
        <select
          value={local.status}
          onChange={(e) =>
            setLocal({ ...local, status: e.target.value as ItemStatus })
          }
        >
          <option value="active">В работе</option>
          <option value="maintenance">Обслуживание</option>
          <option value="retired">Списано</option>
        </select>
      </label>
      <label className="field">
        <span className="field__label">Заметки</span>
        <textarea
          rows={2}
          value={local.notes}
          onChange={(e) => setLocal({ ...local, notes: e.target.value })}
        />
      </label>
    </Modal>
  );
}
