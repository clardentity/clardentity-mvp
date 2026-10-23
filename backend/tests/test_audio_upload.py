"""What /audio/transcribe takes before anything is sent to the provider.

The allow-list is the provider's own (OpenAI speech-to-text), since every file
is forwarded as-is; formats phones record that it doesn't take are refused
with a message saying so, and an upload past the provider's 25 MB ceiling is a
413 that never reads more than the limit into memory. No database needed.
"""

import io

import pytest
from fastapi import HTTPException, UploadFile

from app.api.audio import MAX_AUDIO_BYTES, check_audio_type, read_audio


@pytest.mark.parametrize(
    "name",
    ["recording.webm", "voice.m4a", "clip.mp4", "a.mp3", "a.wav", "a.ogg", "a.oga", "a.flac", "A.M4A"],
)
def test_what_the_provider_takes_is_accepted(name):
    check_audio_type(name)


@pytest.mark.parametrize("name", ["memo.caf", "memo.aac", "call.3gp", "note.amr"])
def test_phone_formats_the_provider_refuses_say_so(name):
    with pytest.raises(HTTPException) as exc:
        check_audio_type(name)
    assert exc.value.status_code == 415
    ext = name.rsplit(".", 1)[-1]
    assert f".{ext} recordings can't be transcribed" in exc.value.detail
    assert "webm" in exc.value.detail


@pytest.mark.parametrize("name", ["notes.txt", "blob", "", None])
def test_anything_else_is_unsupported(name):
    with pytest.raises(HTTPException) as exc:
        check_audio_type(name)
    assert exc.value.status_code == 415
    assert exc.value.detail.startswith("Unsupported audio type")


async def test_an_upload_within_the_limit_is_read_whole():
    body = b"\x1a\x45\xdf\xa3" + b"0" * 1000
    out = await read_audio(UploadFile(io.BytesIO(body), size=len(body), filename="r.webm"))
    assert out == body


async def test_a_declared_size_over_the_limit_is_refused_before_reading():
    class _Unreadable(io.BytesIO):
        def read(self, *_a, **_k):
            raise AssertionError("read an upload already known to be too large")

    upload = UploadFile(_Unreadable(), size=MAX_AUDIO_BYTES + 1, filename="r.webm")
    with pytest.raises(HTTPException) as exc:
        await read_audio(upload)
    assert exc.value.status_code == 413
    assert "25 MB" in exc.value.detail


async def test_an_unsized_upload_is_read_no_further_than_one_byte_past_the_limit():
    reads = []

    class _Counting(io.BytesIO):
        def read(self, size=-1):
            reads.append(size)
            return super().read(size)

    upload = UploadFile(_Counting(b"0" * (MAX_AUDIO_BYTES + 10)), size=None, filename="r.webm")
    with pytest.raises(HTTPException) as exc:
        await read_audio(upload)
    assert exc.value.status_code == 413
    assert reads == [MAX_AUDIO_BYTES + 1]
