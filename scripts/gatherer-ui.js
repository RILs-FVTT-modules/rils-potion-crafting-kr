/**
 * gatherer-ui.js
 * Gatherer 모듈 아이템 이름 매칭 한글화 패치.
 *
 * _onGather 실행 중에만 actor.items.getName을 임시 확장:
 *   1. 직접 이름 매칭 (기존 동작)
 *   2. 팩 인덱스 UUID 룩업 fallback
 *      → REQUIRE 필드에 한글 이름을 입력했으나 직접 매칭 실패 시 처리
 *      → 아이템 중복 생성 방지 (stacking)
 *
 * ※ REQUIRE 필드에는 한글 이름을 사용해야 합니다.
 *   영어 이름은 Babele가 팩 인덱스를 번역하므로 역방향 조회 불가.
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

        // actor.items.getName을 임시 확장 (own property로 shadow)
        actor.items.getName = function (name) {
            // 1. 직접 이름 매칭
            const direct = this.find((i) => i.name === name);
            if (direct) return direct;

            // 2. 팩 인덱스 UUID 룩업
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
            return undefined;
        };

        try {
            return await _original.call(
                this,
                consumeDraw,
                harvestActor,
                gatheringActor,
                event,
            );
        } finally {
            // own property 제거 → 프로토타입 메서드 복원
            delete actor.items.getName;
        }
    };
});
