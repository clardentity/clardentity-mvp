from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_current_user
from app.models import User
from app.schemas.biases import (
    BiasCategoryOut,
    BiasListOut,
    BiasOut,
    DecisionCategoryOut,
)
from app.services import taxonomy

router = APIRouter(prefix="/biases", tags=["biases"])


def _to_out(b: taxonomy.Bias) -> BiasOut:
    return BiasOut(
        id=b.id,
        name=b.name,
        definition=b.definition,
        example=b.example,
        categories=list(b.categories),
        variants=list(b.variants),
        defined=b.defined,
    )


@router.get("/categories", response_model=list[BiasCategoryOut])
async def list_categories(
    current_user: User = Depends(get_current_user),
) -> list[BiasCategoryOut]:
    return [
        BiasCategoryOut(
            id=c.id,
            index=c.index,
            name=c.name,
            scenario=c.scenario,
            bias_count=len(c.bias_ids),
        )
        for c in taxonomy.bias_categories()
    ]


@router.get("/decision-categories", response_model=list[DecisionCategoryOut])
async def list_decision_categories(
    current_user: User = Depends(get_current_user),
) -> list[DecisionCategoryOut]:
    out = []
    for c in taxonomy.decision_categories():
        mapped = taxonomy.bias_category_for_decision(c.id)
        out.append(
            DecisionCategoryOut(
                id=c.id,
                name=c.name,
                examples=[dict(e) for e in c.examples],
                bias_category_id=mapped.id if mapped else None,
            )
        )
    return out


@router.get("", response_model=BiasListOut)
async def list_biases(
    q: str = Query(default="", description="Free-text match on name or definition"),
    category: str | None = Query(default=None),
    defined_only: bool = Query(
        default=False, description="Only entries that carry a definition"
    ),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
) -> BiasListOut:
    if category and taxonomy.get_category(category) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Unknown bias category"
        )

    results = taxonomy.search_biases(q, category)
    if defined_only:
        results = [b for b in results if b.defined]

    return BiasListOut(
        total=len(results),
        biases=[_to_out(b) for b in results[offset : offset + limit]],
    )


@router.get("/{bias_id}", response_model=BiasOut)
async def get_bias(
    bias_id: str,
    current_user: User = Depends(get_current_user),
) -> BiasOut:
    bias = taxonomy.get_bias(bias_id)
    if bias is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown bias")
    return _to_out(bias)
