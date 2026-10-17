package androidx.compose.ui.graphics
import androidx.compose.ui.geometry.Offset
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
// 2D affine subset of Compose's Matrix: rotateZ and scale, applied like Compose (pre-multiplied).
class Matrix {
    var a = 1f; var b = 0f; var c = 0f; var d = 1f
    fun rotateZ(degrees: Float) {
        val radians = degrees * PI.toFloat() / 180f; val cosine = cos(radians); val sine = sin(radians)
        val nextA = a * cosine + c * sine; val nextB = b * cosine + d * sine
        val nextC = -a * sine + c * cosine; val nextD = -b * sine + d * cosine
        a = nextA; b = nextB; c = nextC; d = nextD
    }
    fun scale(x: Float = 1f, y: Float = 1f) { a *= x; b *= x; c *= y; d *= y }
    fun map(o: Offset) = Offset(a * o.x + c * o.y, b * o.x + d * o.y)
}
