/**
 * gatherer-ui.js
 * Gatherer 모듈 아이템 이름 매칭 한글화 패치.
 *
 * _onGather 실행 중 두 가지 체크를 임시 확장:
 *
 * [1] REQUIRE 체크 (actor.items.getName)
 *   - 직접 이름 매칭 (기존 동작)
 *   - 팩 인덱스 UUID 룩업 fallback
 *   - Babele 번역명 매칭: '{한글번역} {영문원본}' 형식 대응
 *     예: 'Herbalism Kit' ↔ '약초학 키트 Herbalism Kit'
 *
 * [2] TOOL 체크 (actor.system.tools[key])
 *   - actor.system.tools에 항목이 없지만 인벤토리에 해당 도구 아이템이 있으면
 *     TOOLDC를 임시로 0으로 shadow하여 체크를 통과시킴
 *   - 번역으로 인해 시스템이 도구 숙련도를 인식 못하는 경우 대응
 */

Hooks.once("ready", () => {
    const GathererSheet = globalThis.gatherer;
    if (!GathererSheet?.prototype?._onGather) return;

    const _original = GathererSheet.prototype._onGather;

    GathererSheet.prototype._onGather = async function (
        consumeDraw,
        harvestActor,
        gatheringActor,
        event,
    ) {
        const actor =
            gatheringActor ??
            canvas?.tokens?.controlled?.[0]?.actor ??
            game.user?.character;

        if (!actor)
            return _original.call(
                this,
                consumeDraw,
                harvestActor,
                gatheringActor,
                event,
            );

        // [1] actor.items.getName 임시 확장 (REQUIRE 체크용)
        actor.items.getName = function (name) {
            // 직접 이름 매칭
            const direct = this.find((i) => i.name === name);
            if (direct) return direct;

            // 팩 인덱스 UUID 룩업
            const lowerName = name?.toLowerCase();
            for (const pack of game.packs.filter(
                (p) => p.documentName === "Item",
            )) {
                const entry = pack.index.find(
                    (e) =>
                        e.name === name ||
                        e.name?.toLowerCase() === lowerName,
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

            // Babele 번역명 매칭 ('{한글번역} {영문원본}' 형식 대응)
            // 예: 검색 'Herbalism Kit' ↔ 아이템 '약초학 키트 Herbalism Kit'
            if (name) {
                const babelMatch = this.find((i) => {
                    if (!i.name) return false;
                    return (
                        i.name.endsWith(` ${name}`) ||
                        name.endsWith(` ${i.name}`)
                    );
                });
                if (babelMatch) return babelMatch;
            }

            return undefined;
        };

        // [2] TOOL 체크 bypass
        // actor.system.tools[key]가 없지만 인벤토리에 해당 도구가 있으면
        // TOOLDC를 임시로 0으로 shadow → 조기 차단 에러 우회
        let toolDCShadowed = false;
        if (this.TOOLDC && this.TOOL) {
            const toolKey = this.TOOL;
            if (!actor.system?.tools?.[toolKey]) {
                const toolLabel = this.getToolLabelFromKey?.(toolKey) ?? "";
                const toolItem = actor.items.find((i) => {
                    if (!i.name) return false;
                    // type=tool 이고 system identifier 일치
                    if (i.type === "tool" && i.system?.type?.value === toolKey)
                        return true;
                    // 이름 직접 일치
                    if (i.name === toolLabel) return true;
                    // Babele 번역명 포함 매칭
                    if (toolLabel) {
                        if (i.name.endsWith(` ${toolLabel}`)) return true;
                        if (toolLabel.endsWith(` ${i.name}`)) return true;
                    }
                    return false;
                });
                if (toolItem) {
                    Object.defineProperty(this, "TOOLDC", {
                        get: () => 0,
                        configurable: true,
                    });
                    toolDCShadowed = true;
                }
            }
        }

        try {
            return await _original.call(
                this,
                consumeDraw,
                harvestActor,
                gatheringActor,
                event,
            );
        } finally {
            delete actor.items.getName;
            if (toolDCShadowed) delete this.TOOLDC;
        }
    };
});
