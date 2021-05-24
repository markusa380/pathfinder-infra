import * as cdk from "@aws-cdk/core";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as efs from "@aws-cdk/aws-efs";
import * as elb from "@aws-cdk/aws-elasticloadbalancingv2";
import * as s3 from "@aws-cdk/aws-s3";
import * as logs from "@aws-cdk/aws-logs";
import * as autoscaling from "@aws-cdk/aws-autoscaling";
import { CfnOutput } from "@aws-cdk/core";

export class PathfinderInfraStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cron expressions in UTC
    const startTime = "cron(0 18 * * ? *)"; // 19:00 BST
    const stopTime = "cron(0 23 * * ? *)"; // 00:00 BST

    const teamspeakCpu = 256;
    const teamspeakMem = 1024;

    const armaCpu = 2048;
    const armaMem = 4096;

    const UDP = {
      ecsProtocol: ecs.Protocol.UDP,
      elbProtocol: elb.Protocol.UDP,
      ec2Protocol: ec2.Protocol.UDP,
    };

    const TCP = {
      ecsProtocol: ecs.Protocol.TCP,
      elbProtocol: elb.Protocol.TCP,
      ec2Protocol: ec2.Protocol.TCP,
    };

    const teamspeakPorts = [
      {
        port: 10011,
        protocol: TCP,
      },
      {
        port: 30033,
        protocol: TCP,
      },
      {
        port: 9987,
        protocol: UDP,
      },
    ];

    const teamspeakHealthcheckPort = 10011;

    const armaPorts = [
      {
        port: 2302,
        protocol: UDP,
      },
      {
        port: 2303,
        protocol: UDP,
      },
      {
        port: 2304,
        protocol: UDP,
      },
      {
        port: 2305,
        protocol: UDP,
      },
      {
        port: 2306,
        protocol: UDP,
      },
    ];

    const armaHealthcheckPort = 12345;

    const vpc = new ec2.Vpc(this, "MainVpc");

    const loadBalancer = new elb.NetworkLoadBalancer(this, "LoadBalancer", {
      vpc: vpc,
      internetFacing: true,
    });

    const mainCluster = new ecs.Cluster(this, "MainCluster", {
      vpc: vpc,
    });

    // ### SECURITY GROUPS ### //

    const teamspeakSecurityGroup = new ec2.SecurityGroup(this, "TeamspeakSg", {
      vpc: vpc,
      allowAllOutbound: true,
    });

    const teamspeakPersistenceFsSg = new ec2.SecurityGroup(
      this,
      "TeamspeakPersistenceFsSg",
      {
        vpc: vpc,
        allowAllOutbound: true,
      }
    );

    const armaSecurityGroup = new ec2.SecurityGroup(this, "ArmaSg", {
      vpc: vpc,
      allowAllOutbound: true,
    });

    teamspeakPorts.forEach((forwarding) => {
      teamspeakSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        PathfinderInfraStack.port(
          forwarding.protocol.ec2Protocol,
          forwarding.port
        ),
        "Access for clients of TeamSpeak"
      );
    });

    teamspeakPersistenceFsSg.addIngressRule(
      teamspeakSecurityGroup,
      ec2.Port.allTraffic(),
      "Access for Teamspeak to persistence volume"
    );

    armaPorts.forEach((forwarding) => {
      armaSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(), // TODO: Only LB
        PathfinderInfraStack.port(
          forwarding.protocol.ec2Protocol,
          forwarding.port
        ),
        "Access for clients of Arma"
      );
    });

    armaSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(), // TODO: Only LB
      PathfinderInfraStack.port(ec2.Protocol.TCP, 12345),
      "Health check of Arma"
    );

    // ### S3 BUCKETS ### //

    const dataBucket = new s3.Bucket(this, "ArmaDataBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const missionsBucket = new s3.Bucket(this, "ArmaMissionsBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const modsBucket = new s3.Bucket(this, "ArmaModsBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ### TEAMSPEAK SERVICE ### //

    const teamspeakPersistenceFs = new efs.FileSystem(
      this,
      "TeamspeakPersistenceFs",
      {
        vpc: vpc,
        securityGroup: teamspeakPersistenceFsSg,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }
    );

    const teamspeakPersistenceVolume: ecs.Volume = {
      name: "TeamspeakPersistence",
      efsVolumeConfiguration: {
        fileSystemId: teamspeakPersistenceFs.fileSystemId,
        rootDirectory: "/",
      },
    };

    const teamspeakTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "TeamspeakTask",
      {
        cpu: teamspeakCpu,
        memoryLimitMiB: teamspeakMem,
      }
    );

    teamspeakTaskDefinition.addVolume(teamspeakPersistenceVolume);

    const teamspeakTaskContainer = teamspeakTaskDefinition.addContainer(
      "TeamspeakContainer",
      {
        image: ecs.ContainerImage.fromRegistry("teamspeak"),
        memoryLimitMiB: teamspeakMem,
        environment: {
          TS3SERVER_LICENSE: "accept",
        },
        logging: ecs.AwsLogDriver.awsLogs({
          streamPrefix: "Teamspeak",
          logRetention: logs.RetentionDays.ONE_DAY,
        }),
        portMappings: teamspeakPorts.map((element) => {
          return {
            containerPort: element.port,
            hostPort: element.port,
            protocol: element.protocol.ecsProtocol,
          };
        }),
      }
    );

    teamspeakTaskContainer.addMountPoints({
      sourceVolume: teamspeakPersistenceVolume.name,
      containerPath: "/var/ts3server/",
      readOnly: false,
    });

    const teamspeakService = new ecs.FargateService(this, "TeamspeakService", {
      taskDefinition: teamspeakTaskDefinition,
      cluster: mainCluster,
      securityGroups: [teamspeakSecurityGroup],
      maxHealthyPercent: 100,
      minHealthyPercent: 0,
    });

    teamspeakPorts.forEach((forwarding) => {
      const listener = loadBalancer.addListener(`Listener${forwarding.port}`, {
        port: forwarding.port,
        protocol: forwarding.protocol.elbProtocol,
      });

      listener.addTargets(`AddTargetGroupsId${forwarding.port}`, {
        port: forwarding.port,
        protocol: forwarding.protocol.elbProtocol,
        targets: [
          teamspeakService.loadBalancerTarget({
            containerName: "TeamspeakContainer",
            containerPort: forwarding.port,
            // Not actually used - still fails without it
            protocol: forwarding.protocol.ecsProtocol,
          }),
        ],
        healthCheck: {
          protocol: elb.Protocol.TCP,
          port: teamspeakHealthcheckPort.toString(),
        },
      });
    });

    // Autoscaling

    const teamspeakScaling = teamspeakService.autoScaleTaskCount({
      maxCapacity: 1,
      minCapacity: 0,
    });

    teamspeakScaling.scaleOnSchedule("TeamspeakAutoscaleOnSchedule", {
      schedule: autoscaling.Schedule.expression(startTime),
      minCapacity: 1,
      maxCapacity: 1,
    });

    teamspeakScaling.scaleOnSchedule("TeamspeakAutoscaleOffSchedule", {
      schedule: autoscaling.Schedule.expression(stopTime),
      minCapacity: 0,
      maxCapacity: 0,
    });

    // ### ARMA SERVICE ### //

    const armaTaskDefinition = new ecs.FargateTaskDefinition(this, "ArmaTask", {
      cpu: armaCpu,
      memoryLimitMiB: armaMem,
    });

    dataBucket.grantRead(armaTaskDefinition.taskRole);
    missionsBucket.grantRead(armaTaskDefinition.taskRole);
    modsBucket.grantRead(armaTaskDefinition.taskRole);

    const armaPortMappings = armaPorts.map((element) => {
      return {
        containerPort: element.port,
        hostPort: element.port,
        protocol: element.protocol.ecsProtocol,
      };
    });

    // Add healthcheck port to port mappings
    armaPortMappings.push({
      containerPort: armaHealthcheckPort,
      hostPort: armaHealthcheckPort,
      protocol: ecs.Protocol.TCP,
    });

    const armaPersistenceFsSg = new ec2.SecurityGroup(
      this,
      "ArmaPersistenceFsSg",
      {
        vpc: vpc,
        allowAllOutbound: true,
      }
    );

    armaPersistenceFsSg.addIngressRule(
      armaSecurityGroup,
      ec2.Port.allTraffic(),
      "Access for Arma to persistence volume"
    );

    const armaPersistenceFs = new efs.FileSystem(this, "ArmaPersistenceFs", {
      vpc: vpc,
      securityGroup: armaPersistenceFsSg,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const armaProfilePersistenceVolume: ecs.Volume = {
      name: "ArmaProfilePersistence",
      efsVolumeConfiguration: {
        fileSystemId: armaPersistenceFs.fileSystemId,
      },
    };

    armaTaskDefinition.addVolume(armaProfilePersistenceVolume);

    const armaTaskContainer = armaTaskDefinition.addContainer("ArmaContainer", {
      image: ecs.ContainerImage.fromRegistry(
        "markusa380/arma3server:release-23"
      ),
      memoryLimitMiB: armaMem,
      environment: {
        STEAM_USER: "markusa390server",
        STEAM_PASSWORD: "VasuBikiYaru8]", // TODO: Secret?
        DATA_BUCKET: dataBucket.bucketName,
        MISSIONS_BUCKET: missionsBucket.bucketName,
        MODS_BUCKET: modsBucket.bucketName
      },
      logging: ecs.AwsLogDriver.awsLogs({
        streamPrefix: "Arma",
        logRetention: logs.RetentionDays.ONE_DAY,
      }),
      portMappings: armaPortMappings,
    });

    armaTaskContainer.addMountPoints({
      sourceVolume: armaProfilePersistenceVolume.name,
      containerPath: "/arma3/configs/profiles/",
      readOnly: false,
    });

    const armaService = new ecs.FargateService(this, "ArmaService", {
      taskDefinition: armaTaskDefinition,
      cluster: mainCluster,
      securityGroups: [armaSecurityGroup],
      maxHealthyPercent: 100,
      minHealthyPercent: 0,
    });

    armaPorts.forEach((forwarding) => {
      const listener = loadBalancer.addListener(`Listener${forwarding.port}`, {
        port: forwarding.port,
        protocol: forwarding.protocol.elbProtocol,
      });

      listener.addTargets(`AddTargetGroupsId${forwarding.port}`, {
        port: forwarding.port,
        protocol: forwarding.protocol.elbProtocol,
        targets: [
          armaService.loadBalancerTarget({
            containerName: "ArmaContainer",
            containerPort: forwarding.port,
            // Not actually used - still fails without it
            protocol: forwarding.protocol.ecsProtocol,
          }),
        ],
        healthCheck: {
          protocol: elb.Protocol.TCP,
          port: armaHealthcheckPort.toString(),
        },
      });
    });

    // Autoscaling
    const armaScaling = armaService.autoScaleTaskCount({
      maxCapacity: 1,
      minCapacity: 0,
    });

    armaScaling.scaleOnSchedule("ArmaAutoscaleOnSchedule", {
      schedule: autoscaling.Schedule.expression(startTime),
      minCapacity: 1,
      maxCapacity: 1,
    });

    armaScaling.scaleOnSchedule("ArmaAutoscaleOffSchedule", {
      schedule: autoscaling.Schedule.expression(stopTime),
      minCapacity: 0,
      maxCapacity: 0,
    });

    // ### OUTPUTS ### //
    const serverAddressOutput = new CfnOutput(this, "ServerAddressOutput", {
      value: loadBalancer.loadBalancerDnsName,
      description: "Server address",
    });

    const dataBucketNameOutput = new CfnOutput(this, "DataBucketNameOutput", {
      value: dataBucket.bucketName,
      description: "Data bucket",
    });

    const missionsBucketNameOutput = new CfnOutput(
      this,
      "MissionsBucketNameOutput",
      {
        value: missionsBucket.bucketName,
        description: "Missions bucket",
      }
    );

    const modsBucketNameOutput = new CfnOutput(
      this,
      "ModsBucketNameOutput",
      {
        value: modsBucket.bucketName,
        description: "Mods bucket"
      }
    )

    this.ephemeralStorageHack(armaTaskDefinition);
  }

  // ### UTILITY METHODS ### //

  static port(protocol: ec2.Protocol, port: number): ec2.Port {
    return new ec2.Port({
      protocol: protocol,
      fromPort: port,
      toPort: port,
      stringRepresentation: port + "@" + protocol,
    });
  }

  ephemeralStorageHack(taskDef: ecs.FargateTaskDefinition): void {
    const props = taskDef.node.defaultChild as ecs.CfnTaskDefinition;
    props.addPropertyOverride("EphemeralStorage", {
      SizeInGiB: 100,
    });
  }
}
