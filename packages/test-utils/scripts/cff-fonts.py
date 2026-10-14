# Builds the CFF fixtures in ../fonts from VendSans-Variable-latin.woff2:
# VendSans-Variable-CFF2.otf, a CFF2 variable font with wght masters at 300
# and 700, and VendSans-Regular-CFF.otf, a static CFF font at 400, both cut
# to printable ASCII, Å and É.
#
#   python3 -m venv venv && venv/bin/pip install fonttools brotli
#   venv/bin/python packages/test-utils/scripts/cff-fonts.py

import os
import tempfile

from fontTools.designspaceLib import AxisDescriptor, DesignSpaceDocument, SourceDescriptor
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib import build
from fontTools.varLib.instancer import instantiateVariableFont

FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fonts")
SOURCE = os.path.join(FONTS, "VendSans-Variable-latin.woff2")


def cff_at(wght, style):
    font = TTFont(SOURCE)
    font.flavor = None
    font = instantiateVariableFont(font, {"wght": wght})
    order = font.getGlyphOrder()
    glyphs = font.getGlyphSet()
    hmtx = font["hmtx"].metrics
    charstrings = {}
    for name in order:
        pen = T2CharStringPen(hmtx[name][0], glyphs)
        glyphs[name].draw(pen)
        charstrings[name] = pen.getCharString()
    fb = FontBuilder(font["head"].unitsPerEm, isTTF=False)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(font.getBestCmap())
    names = {"familyName": "Vend Sans CFF", "styleName": style}
    fb.setupCFF("VendSansCFF-" + style, {"FullName": "Vend Sans CFF " + style}, charstrings, {})
    fb.setupHorizontalMetrics({n: hmtx[n] for n in order})
    hhea = font["hhea"]
    fb.setupHorizontalHeader(ascent=hhea.ascent, descent=hhea.descent)
    fb.setupNameTable(names)
    os2 = font["OS/2"]
    fb.setupOS2(
        sTypoAscender=os2.sTypoAscender,
        sTypoDescender=os2.sTypoDescender,
        usWinAscent=os2.usWinAscent,
        usWinDescent=os2.usWinDescent,
        usWeightClass=wght,
        sCapHeight=os2.sCapHeight,
        sxHeight=os2.sxHeight,
    )
    fb.setupPost()
    for tag in ("GSUB", "GPOS", "GDEF"):
        if tag in font:
            fb.font[tag] = font[tag]
    return fb.font


UNICODES = [*range(0x20, 0x7F), 0xC5, 0xC9]


def save(font, name):
    options = Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    subsetter = Subsetter(options)
    subsetter.populate(unicodes=UNICODES)
    subsetter.subset(font)
    font.save(os.path.join(FONTS, name))


def main():
    save(cff_at(400, "Regular"), "VendSans-Regular-CFF.otf")
    with tempfile.TemporaryDirectory() as tmp:
        doc = DesignSpaceDocument()
        axis = AxisDescriptor()
        axis.tag, axis.name = "wght", "Weight"
        axis.minimum, axis.default, axis.maximum = 300, 300, 700
        doc.addAxis(axis)
        for wght, style in ((300, "Light"), (700, "Bold")):
            path = os.path.join(tmp, style + ".otf")
            cff_at(wght, style).save(path)
            source = SourceDescriptor()
            source.path = path
            source.location = {"Weight": wght}
            doc.addSource(source)
        font, _, _ = build(doc)
        font["name"].setName("Vend Sans CFF2", 1, 3, 1, 0x409)
        font["name"].setName("Vend Sans CFF2", 1, 1, 0, 0)
        save(font, "VendSans-Variable-CFF2.otf")


main()
