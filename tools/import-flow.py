"""Copy Flow-generated images into assets/img with site filenames (.jpg + .webp).

Prefers the 2K upscaled download when one exists. Sources: ~/Downloads (2K
JPEGs) and assets/raw/batch*/ (1K originals extracted from Flow's zips).
usage: python3 tools/import-flow.py
"""
import glob
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DL = os.path.join(ROOT, 'assets/raw/flow-2k')
ESRGAN = os.path.expanduser('~/tools-ai/realesrgan-ncnn-vulkan-20220424-macos/realesrgan-ncnn-vulkan')

# Flow title prefix -> site filename
MAP = {
    'Residential_tower_rendering_at_dusk': 'tower-dusk',
    'Construction_stage': 'construction',
    'Drone_view_above_clouds': 'hero-clouds',
    'Drone_view_of_villa_community': 'aerial-city',
    'Luxury_tower_podium_entrance_view': 'entrance',
    'Luxury_residential_lobby_interior': 'lobby',
    'Drone_view_of_tower_at': 'tower-aerial',
    'Modern_living_room_interior_design': 'room-living',
    'Woman_standing_in_luxury_kitchen': 'room-kitchen',
    'Master_bedroom_with_Dubai_view': 'room-bedroom',
    'Bathroom_with_freestanding_bathtub': 'room-bathroom',
    'Dining_area_with_round_table': 'home-1',
    'Master_bedroom_at_night': 'home-2',
    'Kitchen_island_with_vase_and': 'detail-kitchen',
    'Family_relaxing_together_on_sofa': 'family',
    'Zen_garden_courtyard_with_plants': 'garden-vertical',
    'Bright_yoga_studio_with_mats': 'yoga',
    'Fit_man_doing_sit-ups': 'gym',
    'Dumbbells_and_kettlebells_on_wall': 'gym-equipment',
    'Sauna_and_steam_room': 'sauna',
    'Woman_swimming_in_infinity_pool': 'pool-person',
    'Terrace_with_dining_table_and': 'terrace',
    'Children_playing_in_garden': 'kids-play',
    'Rooftop_padel_court_on_tower': 'padel',
    'Round_jacuzzi_on_wooden_deck': 'jacuzzi',
    'Drone_view_of_podium_amenity': 'podium-top',
    'Aerial_view_of_villa_community': 'aerial-green',
    'Indoor_cricket_batting_simulator…': 'cricket',
    'Lap_pool_on_podium_deck': 'pool-deck',
    'Runner_on_landscaped_walking_track': 'track',
    'Apartment_interior_at_dusk': 'home-3',
    'Dubai_skyline_seen_across_water': 'skyline-small',
    'Outdoor_gym_fitness_equipment_area': 'outdoor-gym',
    'Terrace_lounge_with_fire_pit': 'terrace-social',
    'White_tower_looking_up': 'tower-portrait',
    'Balcony_overlooking_Dubai_skyline': 'home-4',
}


def best_source(prefix):
    two_k = sorted(glob.glob(os.path.join(DL, prefix + '_2K_*.jpg')))
    if two_k:
        return two_k[-1], '2K'
    one_k = sorted(glob.glob(os.path.join(ROOT, 'assets/raw/batch*', prefix + '_2*.jpg')))
    return (one_k[-1], '1K') if one_k else (None, None)


def main():
    out_dir = os.path.join(ROOT, 'assets/img')
    missing = []
    for prefix, name in MAP.items():
        src, res = best_source(prefix)
        if not src:
            missing.append(name)
            continue
        dst = os.path.join(out_dir, name + '.jpg')
        if res == '1K':
            # no 2K download: 4x AI upscale (Real-ESRGAN), then scale down below
            up = os.path.join(out_dir, name + '.up.png')
            subprocess.run([ESRGAN, '-i', src, '-o', up, '-n', 'realesrgan-x4plus',
                            '-m', os.path.join(os.path.dirname(ESRGAN), 'models')],
                           check=True, stderr=subprocess.DEVNULL)
            src = up
        # 2560px wide for Retina screens, quality ~90
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src,
                        '-vf', "scale='min(2560,iw)':-2:flags=lanczos", '-q:v', '2', dst], check=True)
        subprocess.run(['cwebp', '-quiet', '-q', '84', '-m', '6', '-sharp_yuv', dst, '-o', dst[:-4] + '.webp'], check=True)
        if res == '1K':
            os.remove(src)
        print(f'{name:16} <- {res} {os.path.basename(src)}')
    if missing:
        print('MISSING:', ', '.join(missing))


if __name__ == '__main__':
    main()
