package androidx.compose.material3
fun main() {
    val shapes = linkedMapOf(
        "circle" to MaterialShapes.Circle, "square" to MaterialShapes.Square, "slanted" to MaterialShapes.Slanted,
        "arch" to MaterialShapes.Arch, "fan" to MaterialShapes.Fan, "arrow" to MaterialShapes.Arrow,
        "semi-circle" to MaterialShapes.SemiCircle, "oval" to MaterialShapes.Oval, "pill" to MaterialShapes.Pill,
        "triangle" to MaterialShapes.Triangle, "diamond" to MaterialShapes.Diamond, "clam-shell" to MaterialShapes.ClamShell,
        "pentagon" to MaterialShapes.Pentagon, "gem" to MaterialShapes.Gem, "sunny" to MaterialShapes.Sunny,
        "very-sunny" to MaterialShapes.VerySunny, "cookie-4" to MaterialShapes.Cookie4Sided, "cookie-6" to MaterialShapes.Cookie6Sided,
        "cookie-7" to MaterialShapes.Cookie7Sided, "cookie-9" to MaterialShapes.Cookie9Sided, "cookie-12" to MaterialShapes.Cookie12Sided,
        "ghostish" to MaterialShapes.Ghostish, "clover-4" to MaterialShapes.Clover4Leaf, "clover-8" to MaterialShapes.Clover8Leaf,
        "burst" to MaterialShapes.Burst, "soft-burst" to MaterialShapes.SoftBurst, "boom" to MaterialShapes.Boom,
        "soft-boom" to MaterialShapes.SoftBoom, "flower" to MaterialShapes.Flower, "puffy" to MaterialShapes.Puffy,
        "puffy-diamond" to MaterialShapes.PuffyDiamond, "pixel-circle" to MaterialShapes.PixelCircle,
        "pixel-triangle" to MaterialShapes.PixelTriangle, "bun" to MaterialShapes.Bun, "heart" to MaterialShapes.Heart,
    )
    println("{")
    println(shapes.entries.joinToString(",\n") { (name, p) ->
        "\"$name\": [" + p.cubics.joinToString(",") { c ->
            "[${c.anchor0X},${c.anchor0Y},${c.control0X},${c.control0Y},${c.control1X},${c.control1Y},${c.anchor1X},${c.anchor1Y}]"
        } + "]"
    })
    println("}")
}
