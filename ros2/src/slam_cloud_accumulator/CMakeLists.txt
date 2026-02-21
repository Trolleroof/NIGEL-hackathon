cmake_minimum_required(VERSION 3.8)
project(slam_cloud_accumulator)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# find dependencies
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(std_srvs REQUIRED)
find_package(tf2_ros REQUIRED)
find_package(tf2_sensor_msgs REQUIRED)
find_package(pcl_conversions REQUIRED)
find_package(pcl_ros REQUIRED)

find_package(PCL REQUIRED COMPONENTS common filters)

# Boost.Beast (header-only) + Boost.Asio require Boost::system at link time
find_package(Boost REQUIRED COMPONENTS system)
find_package(Threads REQUIRED)

add_executable(slam_cloud_accumulator src/slam_cloud_accumulator.cpp)

target_include_directories(slam_cloud_accumulator PUBLIC
  ${PCL_INCLUDE_DIRS}
)

target_link_libraries(slam_cloud_accumulator
  ${PCL_LIBRARIES}
  Boost::system
  Threads::Threads
)

ament_target_dependencies(slam_cloud_accumulator
  rclcpp
  sensor_msgs
  std_srvs
  tf2_ros
  tf2_sensor_msgs
  pcl_conversions
  pcl_ros
)

install(TARGETS slam_cloud_accumulator
  DESTINATION lib/${PROJECT_NAME}
)

if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  set(ament_cmake_copyright_FOUND TRUE)
  set(ament_cmake_cpplint_FOUND TRUE)
  ament_lint_auto_find_test_dependencies()
endif()

ament_package()
