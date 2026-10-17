package androidx.annotation
annotation class FloatRange(val from: Double = Double.NEGATIVE_INFINITY, val to: Double = Double.POSITIVE_INFINITY, val fromInclusive: Boolean = true, val toInclusive: Boolean = true)
annotation class IntRange(val from: Long = Long.MIN_VALUE, val to: Long = Long.MAX_VALUE)
