import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

/// On-device photo -> doodle, ported from prototypes/doodle/doodle.py.
/// Uses Core Image only (GPU, no network, no ML model) so it is free for every user.
/// A Core ML style model can later replace `stylize` behind the same API.
struct DoodleRenderer {
    static let workingSize: CGFloat = 1024
    private let context = CIContext(options: [.useSoftwareRenderer: false])

    func render(_ photo: UIImage, style: DoodleStyle) -> UIImage? {
        guard let input = CIImage(image: photo)?.oriented(forExifOrientation: photo.exifOrientation) else {
            return nil
        }
        let scaled = resize(input, longSide: Self.workingSize)
        let output: CIImage
        switch style {
        case .crayon: output = crayon(scaled)
        case .pencil: output = pencil(scaled)
        case .watercolor: output = watercolor(scaled)
        }
        guard let cgImage = context.createCGImage(output, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }

    // MARK: Styles

    private func crayon(_ image: CIImage) -> CIImage {
        let flat = flatColors(image, levels: 6, saturation: 1.35)
        let textured = multiply(flat, with: strokeTexture(extent: image.extent, angle: .pi / 5, strength: 0.25))
        return multiply(textured, with: outline(image, threshold: 0.18, width: 2.5))
    }

    private func pencil(_ image: CIImage) -> CIImage {
        let mono = CIFilter.photoEffectNoir()
        mono.inputImage = image
        let lightened = CIFilter.colorControls()
        lightened.inputImage = mono.outputImage
        lightened.brightness = 0.25
        lightened.contrast = 0.8
        let hatched = multiply(lightened.outputImage ?? image, with: strokeTexture(extent: image.extent, angle: .pi / 4, strength: 0.45))
        return multiply(hatched, with: outline(image, threshold: 0.15, width: 1.5))
    }

    private func watercolor(_ image: CIImage) -> CIImage {
        let flat = flatColors(image, levels: 8, saturation: 1.2)
        let blur = CIFilter.gaussianBlur()
        blur.inputImage = flat.clampedToExtent()
        blur.radius = 4
        let bled = (blur.outputImage ?? flat).cropped(to: image.extent)
        let paper = multiply(bled, with: strokeTexture(extent: image.extent, angle: 0, strength: 0.12))
        return multiply(paper, with: outline(image, threshold: 0.25, width: 1.0))
    }

    // MARK: Building blocks

    private func resize(_ image: CIImage, longSide: CGFloat) -> CIImage {
        let scale = longSide / max(image.extent.width, image.extent.height)
        let filter = CIFilter.lanczosScaleTransform()
        filter.inputImage = image
        filter.scale = Float(min(scale, 1))
        return filter.outputImage ?? image
    }

    /// Smooth + posterize + pastel shift (python: _flat_colors).
    private func flatColors(_ image: CIImage, levels: Float, saturation: Float) -> CIImage {
        let median = CIFilter.median()
        median.inputImage = image
        let smooth = CIFilter.noiseReduction()
        smooth.inputImage = median.outputImage
        smooth.noiseLevel = 0.05
        smooth.sharpness = 0
        let posterize = CIFilter.colorPosterize()
        posterize.inputImage = smooth.outputImage
        posterize.levels = levels
        let color = CIFilter.colorControls()
        color.inputImage = posterize.outputImage
        color.saturation = saturation
        color.brightness = 0.06    // pastel shift toward paper
        color.contrast = 0.9
        return color.outputImage ?? image
    }

    /// Dark ink lines on white (python: _outline, difference of Gaussians).
    private func outline(_ image: CIImage, threshold: Float, width: Float) -> CIImage {
        let edges = CIFilter.lineOverlay()
        edges.inputImage = image
        edges.nrNoiseLevel = 0.07
        edges.nrSharpness = 0.71
        edges.edgeIntensity = 1.0
        edges.threshold = threshold
        edges.contrast = 50
        let lines = edges.outputImage ?? image   // black lines, transparent background
        let thick = CIFilter.morphologyMaximum()
        thick.inputImage = lines
        thick.radius = width
        let white = CIImage(color: .white).cropped(to: image.extent)
        return (thick.outputImage ?? lines).composited(over: white).cropped(to: image.extent)
    }

    /// Directional streaks that read as crayon/pencil strokes.
    private func strokeTexture(extent: CGRect, angle: Float, strength: Float) -> CIImage {
        let noise = CIFilter.randomGenerator().outputImage ?? CIImage(color: .gray)
        let streak = CIFilter.motionBlur()
        streak.inputImage = noise.cropped(to: extent.insetBy(dx: -40, dy: -40))
        streak.radius = 12
        streak.angle = angle
        let mono = CIFilter.colorControls()
        mono.inputImage = streak.outputImage
        mono.saturation = 0
        mono.contrast = 1.5
        let blend = CIFilter.colorMatrix()
        blend.inputImage = mono.outputImage
        let s = CGFloat(strength)
        blend.rVector = CIVector(x: s, y: 0, z: 0, w: 0)
        blend.gVector = CIVector(x: 0, y: s, z: 0, w: 0)
        blend.bVector = CIVector(x: 0, y: 0, z: s, w: 0)
        blend.biasVector = CIVector(x: 1 - s, y: 1 - s, z: 1 - s, w: 1)
        return (blend.outputImage ?? noise).cropped(to: extent)
    }

    private func multiply(_ image: CIImage, with layer: CIImage) -> CIImage {
        let filter = CIFilter.multiplyCompositing()
        filter.inputImage = layer
        filter.backgroundImage = image
        return filter.outputImage?.cropped(to: image.extent) ?? image
    }
}

private extension UIImage {
    var exifOrientation: Int32 {
        switch imageOrientation {
        case .up: 1
        case .down: 3
        case .left: 8
        case .right: 6
        case .upMirrored: 2
        case .downMirrored: 4
        case .leftMirrored: 5
        case .rightMirrored: 7
        @unknown default: 1
        }
    }
}
