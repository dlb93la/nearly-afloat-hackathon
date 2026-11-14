import * as THREE from 'three';
export function createNightLighting(scene, sky, sun, { moonlight = .40 } = {}) {
  const daySky = sky.color.clone();
  const dayGround = sky.groundColor.clone();
  const daySun = sun.color.clone();
  const daySkyPower = sky.intensity;
  const daySunPower = sun.intensity;
  const moon = new THREE.Color(0xa4bcf1);
  const darkGround = new THREE.Color(0x456476);
  const fixtures = [];
  const box = new THREE.BoxGeometry();
  const basketGeometry = new THREE.CylinderGeometry(.22, .13, .2, 6);
  const flameGeometry = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(.66, .12), new THREE.Vector2(1, .32),
    new THREE.Vector2(.74, .56), new THREE.Vector2(.40, .76), new THREE.Vector2(0, 1),
  ], 5);
  const sparkGeometry = new THREE.OctahedronGeometry(1);
  const glowGeometry = new THREE.PlaneGeometry(1, 1);
  const origin = new THREE.Vector3();
  const metal = new THREE.MeshLambertMaterial({ color: 0x554436 });
  const shaft = new THREE.MeshLambertMaterial({ color: 0x795139 });
  const hot = new THREE.MeshBasicMaterial({ color: 0xffd383 });
  const ember = new THREE.MeshBasicMaterial({ color: 0xff8337 });
  const flameMaterial = new THREE.ShaderMaterial({
    vertexShader: `varying float height; void main() {
      height = position.y;
      vec3 p = position;
      p.x += .7 * height * height;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
    }`,
    fragmentShader: `varying float height; void main() {
      vec3 coal = vec3(.95, .14, .025);
      vec3 orange = vec3(1., .48, .08);
      vec3 gold = vec3(1., .78, .34);
      vec3 color = mix(coal, orange, smoothstep(.06, .45, height));
      color = mix(color, gold, smoothstep(.28, .54, height) * (1. - smoothstep(.67, 1., height)));
      gl_FragColor = vec4(color, 1.);
    }`,
  });
  const glowMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { strength: { value: 0 } },
    vertexShader: `varying vec2 point; void main() { point = uv - .5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `varying vec2 point; uniform float strength; void main() {
      float halo = 1. - smoothstep(.03, .5, length(point));
      gl_FragColor = vec4(1., .43, .12, halo * halo * strength);
    }`,
  });
  let darkness = 0;
  let previous = -1;

  function torch(parent, x, y, z, { height = 1, power = 0, reach = 5, halo = 0 } = {}) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    parent.add(root);
    const base = new THREE.Mesh(box, shaft);
    base.position.y = height * .5;
    base.scale.set(.105, height, .105);
    const socket = new THREE.Mesh(box, metal);
    socket.position.y = .07;
    socket.scale.set(.22, .14, .22);
    const bowl = new THREE.Mesh(basketGeometry, metal);
    bowl.position.y = height;
    root.add(base, socket, bowl);
    const flame = new THREE.Group();
    flame.position.y = height + .09;
    const outer = new THREE.Mesh(flameGeometry, flameMaterial);
    outer.scale.set(.18, .91, .155);
    const core = new THREE.Mesh(flameGeometry, hot);
    core.position.set(.01, .015, .085);
    core.scale.set(.097, .48, .099);
    core.rotation.z = -.18;
    const spark = new THREE.Mesh(sparkGeometry, ember);
    flame.add(outer, core, spark);
    root.add(flame);
    let glow;
    if (halo) {
      glow = new THREE.Mesh(glowGeometry, glowMaterial);
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = .025;
      glow.scale.setScalar(halo);
      root.add(glow);
    }
    const light = power ? new THREE.PointLight(0xffad59, 0, reach, 2) : null;
    if (light) scene.add(light);
    const fixture = { root, flame, spark, glow, light, power, lightHeight: height + .54, present: true, lit: true, offset: fixtures.length * 2.17 };
    fixtures.push(fixture);
    return fixture;
  }

  function update(time, dt, target, snap = false) {
    darkness = snap ? target : THREE.MathUtils.lerp(darkness, target, 1 - Math.exp(-dt * 6));
    if (Math.abs(target - darkness) < .005) darkness = target;
    if (previous !== darkness) {
      sky.color.copy(daySky).lerp(moon, darkness);
      sky.groundColor.copy(dayGround).lerp(darkGround, darkness);
      sky.intensity = THREE.MathUtils.lerp(daySkyPower, moonlight, darkness);
      sun.color.copy(daySun).lerp(moon, darkness);
      sun.intensity = THREE.MathUtils.lerp(daySunPower, moonlight * .29, darkness);
      glowMaterial.uniforms.strength.value = darkness * .27;
      previous = darkness;
    }
    for (const { root, flame, spark, glow, light, power, lightHeight, present, lit, offset } of fixtures) {
      root.visible = darkness > 0 && present;
      const active = root.visible && lit;
      flame.visible = active;
      if (glow) glow.visible = active;
      const flicker = active ? 1 + .09 * Math.sin(time * 8 + offset) + .05 * Math.sin(time * 13.4 + offset) : 1;
      if (active) {
        flame.scale.y = flicker;
        flame.rotation.z = Math.sin(time * 5.7 + offset) * .15;
        flame.rotation.y = Math.sin(time * 2.3 + offset) * .32;
        const rise = (time * 1.9 + offset) % 1;
        spark.position.set(.05 + rise * .18, .54 + rise * .63, Math.sin(rise * 5 + offset) * .095);
        spark.scale.setScalar(.052 * Math.sin(Math.PI * rise));
      }
      if (light) {
        light.visible = darkness > 0;
        light.intensity = active ? darkness * power * flicker : 0;
        if (active) light.position.copy(root.localToWorld(origin.set(0, lightHeight, 0)));
      }
    }
    return darkness;
  }

  return { torch, update };
}
