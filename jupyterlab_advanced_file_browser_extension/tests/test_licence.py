from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NOTICE = "Copyright (c) 2023, Martin Renou"
PORTED = ["src/model.ts", "src/listing.ts", "style/icons/folder-open.svg"]


def test_acc_unfold_22_notice():
    licence = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert NOTICE in licence
    upstream = licence[licence.index(NOTICE):]
    # The notice must carry the BSD 3-Clause conditions and disclaimer after it.
    assert "Neither the name of the copyright holder" in upstream
    assert "EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE." in upstream

    for name in PORTED:
        text = (ROOT / name).read_text(encoding="utf-8")
        assert NOTICE in text, name
        assert "BSD 3-Clause" in text, name
        assert "jupyterlab-unfold" in text, name
