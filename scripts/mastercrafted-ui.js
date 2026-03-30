/**
 * mastercrafted-ui.js
 * Mastercrafted UI 표시 이름 한글화 패치.
 *
 * - 레시피 시트 렌더 시: 모든 컴포넌트 이름을 Babele 한글 이름으로 배치 업데이트
 *   (단일 document.update() 호출 → 연쇄 리렌더 없음)
 * - 구성 요소 설정 폼: 이름 입력 필드에 한글 이름 표시
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
