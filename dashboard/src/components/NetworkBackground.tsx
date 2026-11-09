import { useEffect, useRef } from "react";
import * as THREE from "three";

const HUB_COLOR = 0x5eead4;
const NODE_COLOR = 0x38bdf8;
const PARTICLE_COLOR = 0x7dd3fc;

export function NetworkBackground() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      52,
      window.innerWidth / window.innerHeight,
      0.1,
      100,
    );
    camera.position.z = 7.2;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.className = "network-canvas";
    host.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    const hubGeometry = new THREE.IcosahedronGeometry(0.62, 1);
    const hubMaterial = new THREE.MeshBasicMaterial({
      color: HUB_COLOR,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    });
    const hub = new THREE.Mesh(hubGeometry, hubMaterial);
    group.add(hub);

    const haloGeometry = new THREE.RingGeometry(0.9, 0.93, 64);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: HUB_COLOR,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    });
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.rotation.x = Math.PI / 2.6;
    group.add(halo);

    const nodePositions = [
      new THREE.Vector3(2.6, 1.1, -0.4),
      new THREE.Vector3(-2.3, 1.5, 0.6),
      new THREE.Vector3(2.1, -1.6, 0.8),
      new THREE.Vector3(-2.7, -1.0, -0.7),
      new THREE.Vector3(0.6, 2.7, 0.2),
    ];

    const nodeGeometry = new THREE.SphereGeometry(0.1, 14, 14);
    const nodeMaterial = new THREE.MeshBasicMaterial({ color: NODE_COLOR });
    const nodeMeshes: THREE.Mesh[] = [];
    const lineMaterial = new THREE.LineBasicMaterial({
      color: NODE_COLOR,
      transparent: true,
      opacity: 0.26,
    });
    const lineGeometries: THREE.BufferGeometry[] = [];

    for (const position of nodePositions) {
      const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
      node.position.copy(position);
      group.add(node);
      nodeMeshes.push(node);

      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        position,
      ]);
      lineGeometries.push(lineGeometry);
      group.add(new THREE.Line(lineGeometry, lineMaterial));
    }

    const particleCount = window.innerWidth < 720 ? 220 : 460;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      const radius = 2.4 + Math.random() * 2.8;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      particlePositions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      particlePositions[index * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      particlePositions[index * 3 + 2] = radius * Math.cos(phi);
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(particlePositions, 3),
    );
    const particleMaterial = new THREE.PointsMaterial({
      color: PARTICLE_COLOR,
      size: 0.028,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    group.add(particles);

    const packetGeometry = new THREE.SphereGeometry(0.075, 12, 12);
    const packetMaterial = new THREE.MeshBasicMaterial({ color: HUB_COLOR });
    const packet = new THREE.Mesh(packetGeometry, packetMaterial);
    group.add(packet);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clock = new THREE.Clock();
    let frame = 0;
    let elapsed = 0;

    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      if (!reducedMotion) {
        elapsed += clock.getDelta();
        group.rotation.y = elapsed * 0.12;
        group.rotation.x = Math.sin(elapsed * 0.22) * 0.12;
        particles.rotation.y = -elapsed * 0.04;
        halo.rotation.z = elapsed * 0.18;

        const targetIndex = Math.floor(elapsed * 0.42) % nodePositions.length;
        const progress = (elapsed * 0.42) % 1;
        packet.position.lerpVectors(
          new THREE.Vector3(0, 0, 0),
          nodePositions[targetIndex],
          progress,
        );
        packetMaterial.opacity = Math.sin(progress * Math.PI);
        packetMaterial.transparent = true;
      }
      renderer.render(scene, camera);
    };

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener("resize", handleResize);
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      group.remove(...nodeMeshes);
      nodeGeometry.dispose();
      nodeMaterial.dispose();
      lineGeometries.forEach((geometry) => geometry.dispose());
      lineMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      packetGeometry.dispose();
      packetMaterial.dispose();
      hubGeometry.dispose();
      hubMaterial.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === host) {
        host.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div className="network-bg" ref={hostRef} aria-hidden="true" />;
}
