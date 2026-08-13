from pydantic import BaseModel


class ProInterestRequest(BaseModel):
    #: Which locked model was clicked. Free text from the client, narrowed to
    #: the known set server-side.
    model: str | None = None
