// Minimal stand-ins for Android/Compose types used by graphics-shapes and MaterialShapes.
@file:Suppress("unused")
package androidx.collection
class FloatFloatPair(val first: Float, val second: Float) {
    operator fun component1() = first
    operator fun component2() = second
    override fun equals(other: Any?) = other is FloatFloatPair && other.first == first && other.second == second
    override fun hashCode() = 31 * first.hashCode() + second.hashCode()
}
class MutableFloatList(capacity: Int = 16) {
    private val items = ArrayList<Float>(capacity)
    fun add(v: Float): Boolean = items.add(v)
    operator fun get(i: Int): Float = items[i]
    val size: Int get() = items.size
}
