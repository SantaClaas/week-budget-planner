package androidx.compose.ui.geometry
import kotlin.math.sqrt
data class Offset(val x: Float, val y: Float) {
    operator fun minus(o: Offset) = Offset(x - o.x, y - o.y)
    operator fun plus(o: Offset) = Offset(x + o.x, y + o.y)
    operator fun times(f: Float) = Offset(x * f, y * f)
    fun getDistance() = sqrt(x * x + y * y)
    companion object { val Zero = Offset(0f, 0f) }
}
