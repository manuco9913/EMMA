import { writeFileSync } from 'fs'

// PMTiles v3 header layout (127 bytes):
// [0-1]     uint16 LE  magic = 0x4D50
// [2]       uint8      spec_version = 3
// [3-10]    uint64 LE  root_dir_offset
// [11-18]   uint64 LE  root_dir_length
// [19-26]   uint64 LE  metadata_offset
// [27-34]   uint64 LE  metadata_length
// [35-42]   uint64 LE  leaf_dirs_offset
// [43-50]   uint64 LE  leaf_dirs_length
// [51-58]   uint64 LE  tile_data_offset
// [59-66]   uint64 LE  tile_data_length
// [67-74]   uint64 LE  num_addressed_tiles
// [75-82]   uint64 LE  num_tile_entries
// [83-90]   uint64 LE  num_tile_contents
// [91]      uint8      clustered
// [92]      uint8      internal_compression (1=none)
// [93]      uint8      tile_compression (1=none)
// [94]      uint8      tile_type (1=MVT)
// [95]      uint8      min_zoom
// [96]      uint8      max_zoom
// [97-100]  int32 LE   min_lon_e7
// [101-104] int32 LE   min_lat_e7
// [105-108] int32 LE   max_lon_e7
// [109-112] int32 LE   max_lat_e7
// [113]     uint8      center_zoom
// [114-117] int32 LE   center_lon_e7
// [118-121] int32 LE   center_lat_e7
// [122-126] reserved

const HEADER_SIZE = 127
const metadata = Buffer.from('{}', 'utf8')
const buf = Buffer.alloc(HEADER_SIZE + metadata.length, 0)

buf.writeUInt16LE(0x4d50, 0)                              // magic
buf.writeUInt8(3, 2)                                      // spec version
buf.writeBigUInt64LE(BigInt(HEADER_SIZE), 3)              // root_dir_offset (empty dir)
buf.writeBigUInt64LE(0n, 11)                              // root_dir_length = 0
buf.writeBigUInt64LE(BigInt(HEADER_SIZE), 19)             // metadata_offset
buf.writeBigUInt64LE(BigInt(metadata.length), 27)         // metadata_length
buf.writeBigUInt64LE(BigInt(HEADER_SIZE + metadata.length), 35) // leaf_dirs_offset
buf.writeBigUInt64LE(0n, 43)                              // leaf_dirs_length
buf.writeBigUInt64LE(BigInt(HEADER_SIZE + metadata.length), 51) // tile_data_offset
buf.writeBigUInt64LE(0n, 59)                              // tile_data_length
buf.writeBigUInt64LE(0n, 67)                              // num_addressed_tiles
buf.writeBigUInt64LE(0n, 75)                              // num_tile_entries
buf.writeBigUInt64LE(0n, 83)                              // num_tile_contents
buf.writeUInt8(0, 91)                                     // clustered
buf.writeUInt8(1, 92)                                     // internal_compression: none
buf.writeUInt8(1, 93)                                     // tile_compression: none
buf.writeUInt8(1, 94)                                     // tile_type: MVT
buf.writeUInt8(0, 95)                                     // min_zoom
buf.writeUInt8(14, 96)                                    // max_zoom
buf.writeInt32LE(-1800000000, 97)                         // min_lon_e7
buf.writeInt32LE(-900000000, 101)                         // min_lat_e7
buf.writeInt32LE(1800000000, 105)                         // max_lon_e7
buf.writeInt32LE(900000000, 109)                          // max_lat_e7
buf.writeUInt8(5, 113)                                    // center_zoom
buf.writeInt32LE(0, 114)                                  // center_lon_e7
buf.writeInt32LE(515000000, 118)                          // center_lat_e7 (51.5°N)
metadata.copy(buf, HEADER_SIZE)

writeFileSync('frontend/public/tiles/tiles.pmtiles', buf)
console.log('tiles.pmtiles created:', buf.length, 'bytes')
