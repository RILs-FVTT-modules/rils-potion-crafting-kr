/**
 * mastercrafted-ui.js
 * Mastercrafted UI 표시 이름 한글화 패치 + 아이템 이름 매칭 패치.
 *
 * [UI 패치]
 * - 레시피 시트 렌더 시: 모든 컴포넌트 이름을 Babele 한글 이름으로 배치 업데이트
 *   (단일 document.update() 호출 → 연쇄 리렌더 없음)
 * - 구성 요소 설정 폼: 이름 입력 필드에 한글 이름 표시
 *
 * [제작 매칭 패치] — Recipe.prototype.craft / _craft 임시 확장
 *   1. REQUIRE 체크: actor.items.getName에 Babele 번역명 fallback 추가
 *      예: 'Herbalism Kit' ↔ '약초학 키트 Herbalism Kit'
 *   2. TOOL 체크: actor.system.tools[key]가 없어도 인벤토리에 해당 도구가 있으면 통과
 *   3. 재료 소비 / 제작물 스태킹도 동일한 getName fallback 적용
 */

const _updatingDocs = new Set();

async function _applyLocalizedNames(recipe) {
  const doc = recipe?.document;
  if (!doc?.isOwner || doc.pack) return; // 잠긴 컴펜디엄 또는 권한 없음
  if (_updatingDocs.has(doc.id)) return; // 이미 업데이트 중 (연쇄 방지)

  const flags = foundry.utils.deepClone(doc.flags?.mastercrafted ?? {});
  let needsUpdate = false;

  const allSections = [...(flags.ingredients ?? []), ...(flags.products ?? [])];

  await Promise.all(
    allSections.flatMap((section) =>
      (section.components ?? []).map(async (component) => {
        if (!component.uuid) return;
        const item = await fromUuid(component.uuid);
        if (item?.name && item.name !== component.name) {
          component.name = item.name;
          needsUpdate = true;
        }
      }),
    ),
  );

  if (!needsUpdate) return;

  _updatingDocs.add(doc.id);
  await doc.update({ flags: { mastercrafted: flags } });
  _updatingDocs.delete(doc.id);
}

// 레시피 시트: 컴포넌트 이름 배치 업데이트 + 툴팁 교체
Hooks.on("renderMastercraftedRecipeSheet", (app, html) => {
  _applyLocalizedNames(app.recipe);

  // 툴팁은 항상 교체 (업데이트 완료 전 첫 렌더에서도 즉시 반영)
  const allComponents = [
    ...(app.recipe?.ingredients ?? []).flatMap((i) => i.components ?? []),
    ...(app.recipe?.products ?? []).flatMap((p) => p.components ?? []),
  ];
  for (const component of allComponents) {
    if (!component.uuid) continue;
    fromUuid(component.uuid).then((item) => {
      if (!item?.name) return;
      const el = html.querySelector(
        `.mastercrafted-component[data-component-id="${component.id}"]`,
      );
      if (!el) return;
      const tooltip = el.dataset.tooltip ?? "";
      el.dataset.tooltip = tooltip.includes(" (x")
        ? item.name + tooltip.slice(tooltip.indexOf(" (x"))
        : item.name;
    });
  }
});

// 구성 요소 설정 폼: 이름 입력 필드 한글화
Hooks.on("renderComponentEditForm", (app, _html) => {
  const uuid = app.component?.uuid;
  if (!uuid) return;
  fromUuid(uuid).then((item) => {
    if (!item?.name) return;
    const nameInput = app.element?.querySelector('input[name="name"]');
    if (nameInput) nameInput.value = item.name;
  });
});

// ============================================================
// 제작 매칭 패치
// ============================================================

/**
 * actor.items.getName을 Babele 번역명 fallback 포함 버전으로 임시 교체.
 * own property로 shadow → finally에서 delete하여 프로토타입 복원.
 */
function _patchGetName(items) {
  items.getName = function (name) {
    // 1. 직접 이름 매칭
    const direct = this.find((i) => i.name === name);
    if (direct) return direct;

    // 2. 팩 인덱스 UUID 룩업
    const lowerName = name?.toLowerCase();
    for (const pack of game.packs.filter((p) => p.documentName === "Item")) {
      const entry = pack.index.find(
        (e) => e.name === name || e.name?.toLowerCase() === lowerName,
      );
      if (!entry) continue;
      const srcUuid = `Compendium.${pack.collection}.Item.${entry._id}`;
      const found = this.find(
        (i) =>
          i._stats?.compendiumSource === srcUuid ||
          i.flags?.core?.sourceId === srcUuid,
      );
      if (found) return found;
    }

    // 3. Babele 번역명 매칭 ('{한글번역} {영문원본}' 형식 대응)
    //    예: 검색 'Herbalism Kit' ↔ 아이템 '약초학 키트 Herbalism Kit'
    if (name) {
      const babelMatch = this.find((i) => {
        if (!i.name) return false;
        return i.name.endsWith(` ${name}`) || name.endsWith(` ${i.name}`);
      });
      if (babelMatch) return babelMatch;
    }

    return undefined;
  };
}

function _unpatchGetName(items) {
  delete items.getName;
}

let _mastercraftedCraftingPatched = false;

Hooks.on("renderMastercraftedRecipeSheet", (app) => {
  if (_mastercraftedCraftingPatched) return;
  const Recipe = app.recipe?.constructor;
  if (!Recipe?.prototype?.craft || !Recipe?.prototype?._craft) return;

  // craft(): REQUIRE 체크용 getName 패치
  // skipConfirm=false 시 craftPrompt()가 즉시 반환되므로
  // _craft()는 별도 패치로 처리
  const _origCraft = Recipe.prototype.craft;
  Recipe.prototype.craft = async function (
    actor,
    inventoryActor,
    data,
    skipConfirm,
  ) {
    _patchGetName(actor.items);
    if (inventoryActor && inventoryActor !== actor)
      _patchGetName(inventoryActor.items);
    try {
      return await _origCraft.call(
        this,
        actor,
        inventoryActor,
        data,
        skipConfirm,
      );
    } finally {
      _unpatchGetName(actor.items);
      if (inventoryActor && inventoryActor !== actor)
        _unpatchGetName(inventoryActor.items);
    }
  };

  // _craft(): 재료 소비, TOOL 체크, 제작물 스태킹용 패치
  const _origInnerCraft = Recipe.prototype._craft;
  Recipe.prototype._craft = async function (
    actor,
    inventoryActor,
    componentsToConsume,
    product,
  ) {
    _patchGetName(actor.items);
    if (inventoryActor && inventoryActor !== actor)
      _patchGetName(inventoryActor.items);

    // TOOL 체크 bypass: actor.system.tools[key]가 없지만 인벤토리에 해당 도구가 있으면
    // toolDc를 임시로 null로 설정하여 noProficiency 에러 우회
    let origToolDc = null;
    let toolDcNulled = false;
    if (
      this.toolCheck &&
      this.toolDc &&
      !actor.system?.tools?.[this.toolCheck]
    ) {
      const toolKey = this.toolCheck;
      const toolLabel = this.getToolLabelFromKey?.(toolKey) ?? "";
      const toolItem = actor.items.find((i) => {
        if (!i.name) return false;
        if (i.type === "tool" && i.system?.type?.value === toolKey) return true;
        if (i.name === toolLabel) return true;
        if (toolLabel) {
          if (i.name.endsWith(` ${toolLabel}`)) return true;
          if (toolLabel.endsWith(` ${i.name}`)) return true;
        }
        return false;
      });
      if (toolItem) {
        origToolDc = this.toolDc;
        this.toolDc = null;
        toolDcNulled = true;
      }
    }

    try {
      return await _origInnerCraft.call(
        this,
        actor,
        inventoryActor,
        componentsToConsume,
        product,
      );
    } finally {
      _unpatchGetName(actor.items);
      if (inventoryActor && inventoryActor !== actor)
        _unpatchGetName(inventoryActor.items);
      if (toolDcNulled) this.toolDc = origToolDc;
    }
  };

  _mastercraftedCraftingPatched = true;
});
