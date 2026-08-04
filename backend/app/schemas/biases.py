from pydantic import BaseModel


class BiasOut(BaseModel):
    id: str
    name: str
    definition: str
    example: str
    categories: list[str]
    variants: list[str]
    # False for entries that appear in the category taxonomy but have no
    # written definition in the source material. They are browsable but are
    # never used for screening, since a flag we cannot explain is not useful.
    defined: bool


class BiasCategoryOut(BaseModel):
    id: str
    index: int
    name: str
    scenario: str
    bias_count: int


class BiasListOut(BaseModel):
    total: int
    biases: list[BiasOut]


class DecisionCategoryOut(BaseModel):
    id: str
    name: str
    examples: list[dict[str, str]]
    bias_category_id: str | None
